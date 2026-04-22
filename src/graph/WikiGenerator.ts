/**
 * WikiGenerator — Structural Markdown wiki from the import graph.
 *
 * Writes .ctxloom/wiki/index.md and one page per Louvain community.
 * Each page contains: files, public API symbols, dependency map, hub skeleton.
 *
 * Hash-cached: the SHA-256 of each page's content is stored in an HTML comment
 * on line 1 (`<!-- hash: {hex16} -->`). Pages are skipped on re-generation
 * unless force=true or the content hash changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DependencyGraph } from './DependencyGraph.js';
import type { Skeletonizer } from '../ast/Skeletonizer.js';
import { CommunityDetector, type Community } from './CommunityDetector.js';

export interface WikiPage {
  slug: string;
  communityName: string;
  filePath: string;
  content: string;
  hash: string;
}

export interface WikiResult {
  written: WikiPage[];
  skipped: WikiPage[];
  wikiDir: string;
}

function slugify(name: string): string {
  return name.replace(/\//g, '-').replace(/^-+|-+$/g, '') || 'root';
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function readStoredHash(filePath: string): string | null {
  try {
    const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0];
    const match = firstLine.match(/^<!-- hash: ([a-f0-9]+) -->$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export class WikiGenerator {
  readonly wikiDir: string;

  constructor(
    private readonly graph: DependencyGraph,
    private readonly rootDir: string,
    private readonly skeletonizer: Skeletonizer,
  ) {
    this.wikiDir = path.join(rootDir, '.ctxloom', 'wiki');
  }

  async generate(force = false): Promise<WikiResult> {
    const files = this.graph.allFiles();
    if (files.length === 0) {
      return { written: [], skipped: [], wikiDir: this.wikiDir };
    }

    const detector = new CommunityDetector(this.graph);
    const communities = detector.detect();

    // Build slug map (id → slug): when multiple communities share the same name,
    // append the community id to disambiguate (e.g. "components-11.md", "components-22.md").
    const nameCount = new Map<string, number>();
    for (const c of communities) {
      nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
    }
    const slugMap = new Map<number, string>();
    for (const c of communities) {
      const baseSlug = slugify(c.name);
      const slug = (nameCount.get(c.name) ?? 1) > 1 ? `${baseSlug}-${c.id}` : baseSlug;
      slugMap.set(c.id, slug);
    }

    // Build name → slug map for cross-community link generation.
    // For duplicate names the first community encountered wins (links are best-effort).
    const nameToSlugMap = new Map<string, string>();
    for (const c of communities) {
      if (!nameToSlugMap.has(c.name)) {
        nameToSlugMap.set(c.name, slugMap.get(c.id)!);
      }
    }

    // Build file → community name map (for cross-community import detection)
    const fileToComm = new Map<string, string>();
    for (const c of communities) {
      for (const f of c.files) fileToComm.set(f, c.name);
    }

    fs.mkdirSync(this.wikiDir, { recursive: true });

    const communityPages: WikiPage[] = await Promise.all(
      communities.map(c => this.buildPage(c, fileToComm, slugMap, nameToSlugMap)),
    );
    const indexPage = this.buildIndex(communities, slugMap);
    const pages = [...communityPages, indexPage];

    const written: WikiPage[] = [];
    const skipped: WikiPage[] = [];

    for (const page of pages) {
      const storedHash = readStoredHash(page.filePath);
      if (!force && storedHash === page.hash) {
        skipped.push(page);
      } else {
        fs.writeFileSync(page.filePath, `<!-- hash: ${page.hash} -->\n${page.content}`);
        written.push(page);
      }
    }

    return { written, skipped, wikiDir: this.wikiDir };
  }

  private async buildPage(
    community: Community,
    fileToComm: Map<string, string>,
    slugMap: Map<number, string>,
    nameToSlugMap: Map<string, string>,
  ): Promise<WikiPage> {
    const slug = slugMap.get(community.id) ?? slugify(community.name);
    const filePath = path.join(this.wikiDir, `${slug}.md`);
    const fileSet = new Set(community.files);

    // Hub files: ranked by internal degree (connections within the community)
    const hubs = community.files
      .map(f => {
        const inDeg = this.graph.getImporters(f).filter(i => fileSet.has(i)).length;
        const outDeg = this.graph.getImports(f).filter(i => fileSet.has(i)).length;
        return { file: f, degree: inDeg + outDeg, inDeg, outDeg };
      })
      .sort((a, b) => b.degree - a.degree);

    // Cross-community imports
    const crossImports = new Map<string, number>();
    for (const f of community.files) {
      for (const imported of this.graph.getImports(f)) {
        const targetComm = fileToComm.get(imported);
        if (targetComm && targetComm !== community.name) {
          crossImports.set(targetComm, (crossImports.get(targetComm) ?? 0) + 1);
        }
      }
    }

    // Symbols defined in community files
    const symbols: Array<{ name: string; type: string; file: string }> = [];
    for (const f of community.files) {
      for (const name of this.graph.lookupSymbolsByFile(f)) {
        const defs = this.graph.lookupSymbol(name);
        const def = defs.find(d => d.filePath === f);
        if (def) symbols.push({ name, type: def.type, file: f });
      }
    }

    // Skeleton of top hub file (best-effort — gracefully skipped if unavailable)
    let skeletonBlock = '';
    if (hubs.length > 0) {
      try {
        const absPath = path.resolve(this.rootDir, hubs[0].file);
        const sk = await this.skeletonizer.skeletonize(absPath);
        skeletonBlock = `\n## Hub File Skeleton\n\n\`\`\`typescript\n${sk}\n\`\`\`\n`;
      } catch {
        // Skeleton unavailable for this language or file not found
      }
    }

    const lines: string[] = [
      `# ${community.name}`,
      '',
      `> Louvain community · **${community.files.length} files** · **${crossImports.size} cross-community dependencies**`,
      '',
      '## Files',
      '',
    ];

    for (const h of hubs) {
      const label = h === hubs[0] ? ' *(hub)*' : '';
      lines.push(`- \`${h.file}\`${label} — in: ${h.inDeg}, out: ${h.outDeg}`);
    }

    if (symbols.length > 0) {
      lines.push('', '## Public API', '', '| Symbol | Type | File |', '|--------|------|------|');
      for (const s of symbols.slice(0, 30)) {
        lines.push(`| \`${s.name}\` | ${s.type} | \`${s.file}\` |`);
      }
    }

    if (crossImports.size > 0) {
      lines.push('', '## Dependencies', '', '| Community | Import Count |', '|-----------|-------------|');
      for (const [name, count] of [...crossImports.entries()].sort((a, b) => b[1] - a[1])) {
        const targetSlug = nameToSlugMap.get(name) ?? slugify(name);
        lines.push(`| [${name}](${targetSlug}.md) | ${count} |`);
      }
    }

    if (skeletonBlock) lines.push(skeletonBlock);

    const content = lines.join('\n');
    const hash = hashContent(content);
    return { slug, communityName: community.name, filePath, content, hash };
  }

  private buildIndex(communities: Community[], slugMap: Map<number, string>): WikiPage {
    const filePath = path.join(this.wikiDir, 'index.md');
    const totalFiles = this.graph.allFiles().length;
    const edgeCount = this.graph.edgeCount();

    const lines = [
      '# ctxloom Wiki',
      '',
      `> Auto-generated from import graph · **${totalFiles} files** · **${communities.length} communities** · **${edgeCount} edges**`,
      '',
      '| Community | Files | Page |',
      '|-----------|-------|------|',
    ];

    const sortedComms = [...communities].sort((a, b) => b.files.length - a.files.length);
    for (const c of sortedComms) {
      const slug = slugMap.get(c.id) ?? slugify(c.name);
      lines.push(`| \`${c.name}\` | ${c.files.length} | [${slug}.md](${slug}.md) |`);
    }

    const content = lines.join('\n');
    const hash = hashContent(content);
    return { slug: 'index', communityName: 'index', filePath, content, hash };
  }
}
