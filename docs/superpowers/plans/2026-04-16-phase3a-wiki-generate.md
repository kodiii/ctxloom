# Phase 3a — ctx_wiki_generate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ctx_wiki_generate` — a tool that produces deterministic Markdown wiki pages (one per Louvain community) describing each community's files, public API, dependency map, and hub file skeleton.

**Architecture:** A `WikiGenerator` class (new file) drives everything: it calls `CommunityDetector`, derives per-community content from the public `DependencyGraph` API, and writes `.ctxloom/wiki/<slug>.md` + `index.md`. Pages are hash-cached (SHA-256 stored in an HTML comment on line 1) and skipped when content is unchanged. The MCP tool wraps `WikiGenerator` and returns XML describing written/skipped pages.

**Tech Stack:** TypeScript/ESM, `node:crypto` (already used in `GrammarLoader`), `node:fs`, vitest. No new npm dependencies.

---

## File Map

### Created
| File | Responsibility |
|------|---------------|
| `src/graph/WikiGenerator.ts` | Core wiki engine: community → Markdown page, hash-cache, write |
| `src/tools/wiki-generate.ts` | `ctx_wiki_generate` MCP tool |
| `tests/WikiGenerator.test.ts` | Unit + integration tests for WikiGenerator |

### Modified
| File | What changes |
|------|-------------|
| `src/tools/index.ts` | Import and register `registerWikiGenerateTool` |
| `src/index.ts` | Add `ctx_wiki_generate` to `--help` Tools Exposed section |

---

## Task 1 — WikiGenerator Class

**Files:**
- Create: `src/graph/WikiGenerator.ts`
- Create: `tests/WikiGenerator.test.ts`

- [ ] **Step 1.1: Write failing WikiGenerator tests**

Create `tests/WikiGenerator.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { WikiGenerator } from '../src/graph/WikiGenerator.js';
import { Skeletonizer } from '../src/ast/Skeletonizer.js';

function makeClusteredGraph(): DependencyGraph {
  const g = new DependencyGraph();
  g.addEdge('src/auth/user.ts', 'src/auth/session.ts');
  g.addEdge('src/auth/user.ts', 'src/auth/token.ts');
  g.addEdge('src/auth/session.ts', 'src/auth/token.ts');
  g.addEdge('src/api/handler.ts', 'src/api/router.ts');
  g.addEdge('src/api/router.ts', 'src/api/middleware.ts');
  g.addEdge('src/api/handler.ts', 'src/api/middleware.ts');
  g.addEdge('src/api/handler.ts', 'src/auth/user.ts');
  return g;
}

describe('WikiGenerator', () => {
  let tmpDir: string;
  let skeletonizer: Skeletonizer;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-wiki-test-'));
    skeletonizer = new Skeletonizer();
    await skeletonizer.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates wiki directory and returns a result', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    expect(result.wikiDir).toBe(path.join(tmpDir, '.ctxloom', 'wiki'));
    expect(fs.existsSync(result.wikiDir)).toBe(true);
    expect(result.written.length + result.skipped.length).toBeGreaterThan(0);
  });

  it('writes index.md with wiki header', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    const indexPath = path.join(result.wikiDir, 'index.md');
    expect(fs.existsSync(indexPath)).toBe(true);
    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toContain('# ctxloom Wiki');
    expect(content).toContain('communities');
  });

  it('writes at least one community page', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    const communityPages = result.written.filter(p => p.slug !== 'index');
    expect(communityPages.length).toBeGreaterThan(0);
  });

  it('community page contains Files and community name', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    const page = result.written.find(p => p.slug !== 'index');
    expect(page).toBeDefined();
    const content = fs.readFileSync(page!.filePath, 'utf-8');
    expect(content).toContain('## Files');
    expect(content).toContain(page!.communityName);
  });

  it('skips pages on second call when content unchanged', async () => {
    const graph = makeClusteredGraph();
    const gen = new WikiGenerator(graph, tmpDir, skeletonizer);
    const first = await gen.generate();
    const second = await gen.generate();
    expect(second.written.length).toBe(0);
    expect(second.skipped.length).toBe(first.written.length);
  });

  it('force=true rewrites all pages', async () => {
    const graph = makeClusteredGraph();
    const gen = new WikiGenerator(graph, tmpDir, skeletonizer);
    const first = await gen.generate();
    const second = await gen.generate(true);
    expect(second.written.length).toBe(first.written.length);
    expect(second.skipped.length).toBe(0);
  });

  it('handles empty graph without writing any files', async () => {
    const gen = new WikiGenerator(new DependencyGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    expect(result.written.length).toBe(0);
    expect(result.skipped.length).toBe(0);
  });

  it('stores hash comment on line 1 of every written page', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    for (const page of result.written) {
      const firstLine = fs.readFileSync(page.filePath, 'utf-8').split('\n')[0];
      expect(firstLine).toMatch(/^<!-- hash: [a-f0-9]+ -->$/);
    }
  });

  it('cross-community imports section appears when communities are coupled', async () => {
    const gen = new WikiGenerator(makeClusteredGraph(), tmpDir, skeletonizer);
    const result = await gen.generate();
    // At least one page should have a Dependencies section (api → auth coupling)
    const hasDeps = result.written.some(p => {
      if (p.slug === 'index') return false;
      const content = fs.readFileSync(p.filePath, 'utf-8');
      return content.includes('## Dependencies');
    });
    expect(hasDeps).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/WikiGenerator.test.ts 2>&1 | tail -8
```

Expected: FAIL — `WikiGenerator` module not found.

- [ ] **Step 1.3: Implement `src/graph/WikiGenerator.ts`**

```typescript
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
  private readonly wikiDir: string;

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

    // Build file → community name map (for cross-community import detection)
    const fileToComm = new Map<string, string>();
    for (const c of communities) {
      for (const f of c.files) fileToComm.set(f, c.name);
    }

    fs.mkdirSync(this.wikiDir, { recursive: true });

    const communityPages: WikiPage[] = await Promise.all(
      communities.map(c => this.buildPage(c, fileToComm)),
    );
    const indexPage = this.buildIndex(communities, communityPages);
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
  ): Promise<WikiPage> {
    const slug = slugify(community.name);
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
        const targetSlug = slugify(name);
        lines.push(`| [${name}](${targetSlug}.md) | ${count} |`);
      }
    }

    if (skeletonBlock) lines.push(skeletonBlock);

    const content = lines.join('\n');
    const hash = hashContent(content);
    return { slug, communityName: community.name, filePath, content, hash };
  }

  private buildIndex(communities: Community[], communityPages: WikiPage[]): WikiPage {
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
      const slug = slugify(c.name);
      lines.push(`| \`${c.name}\` | ${c.files.length} | [${slug}.md](${slug}.md) |`);
    }

    const content = lines.join('\n');
    const hash = hashContent(content);
    return { slug: 'index', communityName: 'index', filePath, content, hash };
  }
}
```

- [ ] **Step 1.4: Run WikiGenerator tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/WikiGenerator.test.ts 2>&1 | tail -15
```

Expected: All 9 tests pass.

- [ ] **Step 1.5: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3 && npx tsc --noEmit 2>&1 | head -20
```

Expected: All tests pass, 0 TS errors.

- [ ] **Step 1.6: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/graph/WikiGenerator.ts tests/WikiGenerator.test.ts
git commit -m "feat: WikiGenerator — deterministic Markdown wiki from Louvain communities"
```

---

## Task 2 — `ctx_wiki_generate` Tool + Wire Up

**Files:**
- Create: `src/tools/wiki-generate.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 2.1: Implement `src/tools/wiki-generate.ts`**

```typescript
/**
 * ctx_wiki_generate — Generate structural Markdown wiki for each community.
 *
 * Writes .ctxloom/wiki/index.md + one page per Louvain community.
 * Pages are hash-cached; only updated when content changes.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { WikiGenerator } from '../graph/WikiGenerator.js';

const Schema = z.object({
  force: z.boolean().optional().default(false).describe(
    'Regenerate all pages even if content unchanged (default: false)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerWikiGenerateTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_wiki_generate',
    {
      name: 'ctx_wiki_generate',
      description:
        'Generate structural Markdown wiki pages for each Louvain community. ' +
        'Writes to .ctxloom/wiki/: one page per community with its files, public API, ' +
        'dependency map, and hub file skeleton. Pages are hash-cached — only updated when content changes. ' +
        'No LLM required — purely structural, always reproducible.',
      inputSchema: {
        type: 'object',
        properties: {
          force: {
            type: 'boolean',
            description: 'Regenerate all pages even if content is unchanged (default: false)',
          },
        },
      },
    },
    async (args) => {
      const { force } = Schema.parse(args);
      const [graph, skeletonizer] = await Promise.all([ctx.getGraph(), ctx.getSkeletonizer()]);
      const generator = new WikiGenerator(graph, ctx.projectRoot, skeletonizer);
      const result = await generator.generate(force);

      const lines = [
        `<wiki_generate wiki_dir="${escapeXML(result.wikiDir)}" written="${result.written.length}" skipped="${result.skipped.length}">`,
      ];
      for (const p of result.written) {
        lines.push(`  <page community="${escapeXML(p.communityName)}" file="${escapeXML(p.filePath)}" status="written" />`);
      }
      for (const p of result.skipped) {
        lines.push(`  <page community="${escapeXML(p.communityName)}" file="${escapeXML(p.filePath)}" status="skipped" />`);
      }
      lines.push('</wiki_generate>');
      return lines.join('\n');
    },
  );
}
```

- [ ] **Step 2.2: Register in `src/tools/index.ts`**

Read `src/tools/index.ts`. Add the import after the existing bridge-nodes import:

```typescript
import { registerWikiGenerateTool } from './wiki-generate.js';
```

And inside `createToolRegistry`, add after `registerSurprisingConnectionsTool(registry, ctx);`:

```typescript
registerWikiGenerateTool(registry, ctx);
```

- [ ] **Step 2.3: Update help text in `src/index.ts`**

Read `src/index.ts`. Find the line `  ctx_surprising_connections Circular deps...`. Add directly after it:

```
  ctx_wiki_generate          Generate .ctxloom/wiki/ — one Markdown page per community
```

- [ ] **Step 2.4: Add integration test to `tests/GraphIntelligenceTools.test.ts`**

Read `tests/GraphIntelligenceTools.test.ts`. At the top, add after the other imports:

```typescript
import { registerWikiGenerateTool } from '../src/tools/wiki-generate.js';
```

And append a new describe block at the end of the file:

```typescript
// ─── ctx_wiki_generate ─────────────────────────────────────────────────────

describe('ctx_wiki_generate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-wiki-tool-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns XML with wiki_generate element', async () => {
    const registry = new ToolRegistry();
    registerWikiGenerateTool(registry, makeCtx(makeGraph(), tmpDir));
    const result = await registry.dispatch('ctx_wiki_generate', {});
    expect(result).toContain('<wiki_generate');
    expect(result).toContain('</wiki_generate>');
  });

  it('includes written and skipped counts', async () => {
    const registry = new ToolRegistry();
    registerWikiGenerateTool(registry, makeCtx(makeGraph(), tmpDir));
    const result = await registry.dispatch('ctx_wiki_generate', {});
    expect(result).toMatch(/written="\d+"/);
    expect(result).toMatch(/skipped="\d+"/);
  });

  it('second call skips all pages (cache hit)', async () => {
    const ctx = makeCtx(makeGraph(), tmpDir);
    const registry1 = new ToolRegistry();
    registerWikiGenerateTool(registry1, ctx);
    await registry1.dispatch('ctx_wiki_generate', {});

    const registry2 = new ToolRegistry();
    registerWikiGenerateTool(registry2, ctx);
    const second = await registry2.dispatch('ctx_wiki_generate', {});
    expect(second).toContain('written="0"');
  });

  it('force=true rewrites all pages', async () => {
    const ctx = makeCtx(makeGraph(), tmpDir);
    const r1 = new ToolRegistry();
    registerWikiGenerateTool(r1, ctx);
    const first = await r1.dispatch('ctx_wiki_generate', {});
    const firstWritten = Number((first.match(/written="(\d+)"/) ?? [])[1] ?? 0);

    const r2 = new ToolRegistry();
    registerWikiGenerateTool(r2, ctx);
    const second = await r2.dispatch('ctx_wiki_generate', { force: true });
    expect(second).toContain(`written="${firstWritten}"`);
    expect(second).toContain('skipped="0"');
  });

  it('handles empty graph', async () => {
    const registry = new ToolRegistry();
    registerWikiGenerateTool(registry, makeCtx(new DependencyGraph(), tmpDir));
    const result = await registry.dispatch('ctx_wiki_generate', {});
    expect(result).toContain('written="0"');
  });
});
```

The `makeCtx` helper also needs `tmpDir` for `projectRoot`. **Update the existing `makeCtx` helper to accept an optional second argument:**

```typescript
function makeCtx(graph: DependencyGraph, projectRoot = '/fake'): ServerContext {
  return {
    projectRoot,
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: async () => {
      const sk = new (await import('../src/ast/Skeletonizer.js')).Skeletonizer();
      await sk.init();
      return sk;
    },
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  };
}
```

Also add at the top of `tests/GraphIntelligenceTools.test.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
```

Note: the existing `makeCtx` has `getSkeletonizer: () => Promise.reject(...)`. That must be updated to the version above that actually creates a real `Skeletonizer`, because `ctx_wiki_generate` calls `ctx.getSkeletonizer()`.

- [ ] **Step 2.5: Run all tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3
```

Expected: All tests pass.

- [ ] **Step 2.6: Type-check + build**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx tsc --noEmit 2>&1 | head -20 && npm run build 2>&1 | tail -5
```

Expected: 0 TS errors, build succeeds.

- [ ] **Step 2.7: CLI smoke test**

```bash
node dist/index.js --help 2>&1 | grep ctx_wiki
```

Expected: `ctx_wiki_generate` listed.

- [ ] **Step 2.8: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/tools/wiki-generate.ts src/tools/index.ts src/index.ts tests/GraphIntelligenceTools.test.ts
git commit -m "feat: ctx_wiki_generate — hash-cached Markdown wiki per Louvain community"
```

---

## Self-Review

**Spec coverage (ROADMAP Phase 3 — ctx_wiki_generate):**
- [x] Community name (longest common directory prefix) → `slugify(community.name)` + `# ${community.name}` heading
- [x] Key files (hub nodes within community) → `## Files` section ranked by internal degree
- [x] Public API (symbols exported by community files) → `## Public API` table from `lookupSymbolsByFile`
- [x] Dependency map (which other communities imported) → `## Dependencies` section
- [x] Skeleton views of top hub file → `## Hub File Skeleton` section, gracefully skipped on failure
- [x] Write to `.ctxloom/wiki/index.md` + `.ctxloom/wiki/<community-name>.md` → WikiGenerator.generate()
- [x] Only regenerate pages whose input data hash changed → hash stored in `<!-- hash: ... -->` comment
- [x] Registered in ToolRegistry → Task 2
- [x] No LLM required → pure structural, no external calls

**Placeholder scan:** None found. All steps have real code.

**Type consistency:** `WikiPage`, `WikiResult` defined in Task 1 and used consistently in Task 2. `makeCtx` updated in Task 2 to support `projectRoot` arg.
