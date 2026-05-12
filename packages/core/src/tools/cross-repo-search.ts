/**
 * ctx_cross_repo_search — Federated vector search across registered repos.
 *
 * Repos are registered via `ctxloom register <path>` (or programmatically
 * via the RepoRegistry class). Each registered repo has its own LanceDB
 * store at `<root>/.ctxloom/vectors.lancedb`.
 *
 * On a search query:
 *   1. Embed the query with the shared embedding model
 *   2. Query each registered repo's LanceDB store in parallel
 *   3. Merge and re-rank results by score (ascending = more similar)
 *   4. Return top-K across all repos, annotated with repo root
 *
 * Repos with missing or uninitialized stores are silently skipped —
 * they appear in the output as `skipped="true"`.
 */
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { generateEmbedding } from '../indexer/embedder.js';
import { VectorStore } from '../db/VectorStore.js';
import { logger } from '../utils/logger.js';

// ─── RepoRegistry ─────────────────────────────────────────────────────────

export interface RegisteredRepo {
  root: string;            // absolute path to repo root
  dbPath: string;          // absolute path to the LanceDB store
  name: string;            // display name (basename of root)
  alias?: string;          // optional short name for `project_root` lookups
  registeredAt: string;    // ISO date string
}

const ALIAS_REGEX = /^[a-z0-9-]{1,40}$/;

const RESERVED_ALIASES = new Set([
  'register', 'repos', 'setup', 'index', 'init', 'dashboard', 'status',
  'trial', 'activate', 'deactivate', 'grammars', 'help', 'review-suggest',
]);

export interface AliasValidation {
  ok: boolean;
  reason?: string;
}

export function validateAlias(alias: string): AliasValidation {
  if (!ALIAS_REGEX.test(alias)) {
    return {
      ok: false,
      reason: `alias must match ${ALIAS_REGEX.source} (lowercase, alphanumeric+hyphen, 1-40 chars)`,
    };
  }
  if (RESERVED_ALIASES.has(alias)) {
    return {
      ok: false,
      reason: `alias '${alias}' shadows a ctxloom subcommand`,
    };
  }
  return { ok: true };
}

export class RepoRegistry {
  private readonly filePath: string;
  private repos: RegisteredRepo[];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.repos = this.load();
  }

  private load(): RegisteredRepo[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as RegisteredRepo[];
    } catch {
      return [];
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.repos, null, 2), 'utf-8');
  }

  list(): RegisteredRepo[] {
    return [...this.repos];
  }

  findByAlias(alias: string): RegisteredRepo | null {
    return this.repos.find((r) => r.alias === alias) ?? null;
  }

  findByPath(absPath: string): RegisteredRepo | null {
    const canonical = path.resolve(absPath);
    return this.repos.find((r) => path.resolve(r.root) === canonical) ?? null;
  }

  register(root: string, dbPath: string, opts: { alias?: string } = {}): void {
    if (opts.alias !== undefined) {
      const v = validateAlias(opts.alias);
      if (!v.ok) throw new Error(`Invalid alias: ${v.reason}`);
      // Reject collision unless the colliding entry has the same root
      const colliding = this.repos.find(
        (r) => r.alias === opts.alias && path.resolve(r.root) !== path.resolve(root),
      );
      if (colliding) {
        throw new Error(
          `Alias '${opts.alias}' is already registered to ${colliding.root}. ` +
          `Pick a different alias or unregister the existing entry first.`,
        );
      }
    }
    const existingIdx = this.repos.findIndex((r) => path.resolve(r.root) === path.resolve(root));
    const entry: RegisteredRepo = {
      root,
      dbPath,
      name: path.basename(root),
      alias: opts.alias,
      registeredAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      this.repos = this.repos.map((r, i) => (i === existingIdx ? entry : r));
    } else {
      this.repos = [...this.repos, entry];
    }
    this.save();
  }

  unregister(root: string): void {
    this.repos = this.repos.filter((r) => path.resolve(r.root) !== path.resolve(root));
    this.save();
  }
}

// ─── Tool ─────────────────────────────────────────────────────────────────

const Schema = z.object({
  query: z.string().min(1).describe('Search query — natural language or code fragment'),
  limit: z.number().min(1).max(100).optional().default(10).describe(
    'Maximum total results across all repos (default: 10)',
  ),
  repos: z.array(z.string()).optional().describe(
    'Specific repo root paths to search. Omit to search all registered repos.',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface CrossRepoResult {
  repo: string;
  repoName: string;
  filePath: string;
  score: number;
  content: string;
}

export function registerCrossRepoSearchTool(
  registry: ToolRegistry,
  _ctx: ServerContext,
  registryFilePath?: string,
): void {
  // Default registry path: ~/.ctxloom/repos.json
  const repoRegistryPath = registryFilePath ??
    path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.ctxloom', 'repos.json');

  registry.register(
    'ctx_cross_repo_search',
    {
      name: 'ctx_cross_repo_search',
      description:
        'Federated semantic search across all registered repos. ' +
        'Embeds the query, queries each registered LanceDB store in parallel, ' +
        'and returns merged results ranked by similarity score. ' +
        'Each result is annotated with its source repo. ' +
        'Register repos with: ctxloom register <path>.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — natural language or code fragment' },
          limit: { type: 'number', description: 'Max total results across all repos (default: 10)' },
          repos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific repo root paths to search. Omit to search all registered repos.',
          },
        },
        required: ['query'],
      },
    },
    async (args) => {
      const { query, limit, repos: filterRepos } = Schema.parse(args);

      const repoReg = new RepoRegistry(repoRegistryPath);
      let candidates = repoReg.list();

      if (filterRepos && filterRepos.length > 0) {
        const filterSet = new Set(filterRepos);
        candidates = candidates.filter(r => filterSet.has(r.root));
      }

      if (candidates.length === 0) {
        return [
          `<cross_repo_search query="${escapeXML(query)}" repos_searched="0" count="0">`,
          '  <!-- No repos registered. Run: ctxloom register <path> -->',
          '</cross_repo_search>',
        ].join('\n');
      }

      // Embed query once, share across all repo searches
      let queryEmbedding: number[];
      try {
        queryEmbedding = await generateEmbedding(query);
      } catch (err) {
        logger.error('Failed to generate embedding for cross-repo search', { detail: err instanceof Error ? err.message : String(err) });
        return `<cross_repo_search query="${escapeXML(query)}" repos_searched="0" count="0" error="embedding_failed" />`;
      }

      // Query all repos in parallel; skip repos with missing/broken stores
      const perRepoLimit = Math.max(limit, 5);
      const repoResults = await Promise.all(
        candidates.map(async (repo): Promise<{ repo: RegisteredRepo; results: CrossRepoResult[]; skipped: boolean }> => {
          // Close after each search — without this, every cross-repo query
          // leaks FDs proportional to the registered-repo count, eventually
          // exhausting the per-process FD limit (256 on macOS) when the
          // MCP server stays alive across many tool calls.
          let store: VectorStore | null = null;
          try {
            store = new VectorStore(repo.dbPath);
            await store.init();
            const raw = await store.search(queryEmbedding, perRepoLimit);
            const results: CrossRepoResult[] = raw.map(r => ({
              repo: repo.root,
              repoName: repo.name,
              filePath: r.filePath,
              score: r.score,
              content: r.content,
            }));
            return { repo, results, skipped: false };
          } catch (err) {
            logger.warn('Cross-repo search: skipping repo with unavailable store', {
              root: repo.root,
              detail: err instanceof Error ? err.message : String(err),
            });
            return { repo, results: [], skipped: true };
          } finally {
            if (store) await store.close();
          }
        }),
      );

      // Merge and rank by score (ascending)
      const allResults: CrossRepoResult[] = repoResults.flatMap(r => r.results);
      allResults.sort((a, b) => a.score - b.score);
      const topResults = allResults.slice(0, limit);

      const searchedCount = repoResults.filter(r => !r.skipped).length;
      const skippedCount = repoResults.filter(r => r.skipped).length;

      const xmlLines: string[] = [
        `<cross_repo_search query="${escapeXML(query)}" repos_searched="${searchedCount}" repos_skipped="${skippedCount}" count="${topResults.length}">`,
      ];

      // Summary of repos searched
      xmlLines.push('  <repos>');
      for (const { repo, results, skipped } of repoResults) {
        xmlLines.push(
          `    <repo root="${escapeXML(repo.root)}" name="${escapeXML(repo.name)}" results="${results.length}" skipped="${skipped}" />`,
        );
      }
      xmlLines.push('  </repos>');

      // Results
      xmlLines.push(`  <results count="${topResults.length}">`);
      for (const r of topResults) {
        xmlLines.push(
          `    <result repo="${escapeXML(r.repoName)}" file="${escapeXML(r.filePath)}" score="${r.score.toFixed(4)}">`,
        );
        if (r.content) {
          xmlLines.push(`      ${escapeXML(r.content.slice(0, 200))}`);
        }
        xmlLines.push('    </result>');
      }
      xmlLines.push('  </results>');

      xmlLines.push('</cross_repo_search>');
      return xmlLines.join('\n');
    },
  );
}
