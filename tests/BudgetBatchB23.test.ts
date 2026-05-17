/**
 * Phase B2.3 — budget surface integration for the 4-tool batch:
 *   ctx_get_definition
 *   ctx_get_context_packet
 *   ctx_search
 *   ctx_full_text_search
 *
 * 6 cases × 4 tools = 24 tests. Same 6-case shape as the B2.2 pilot
 * (tests/FileToolBudget.test.ts), one describe block per tool with
 * per-tool skeleton-path expectations:
 *
 *   ctx_get_definition       no skeleton — over-budget falls through
 *                            to truncation with skeleton_failed
 *   ctx_get_context_packet   skeleton = packet with primary file
 *                            replaced by its Skeletonizer view
 *   ctx_search               skeleton = result list without content
 *                            snippets (paths + scores only)
 *   ctx_full_text_search     skeleton = result list without match
 *                            snippets (paths + match counts only)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerDefinitionTool } from '../src/tools/definition.js';
import { registerContextPacketTool } from '../src/tools/context-packet.js';
import { registerSearchTool } from '../src/tools/search.js';
import { registerFullTextSearchTool } from '../src/tools/full-text-search.js';
import { PathValidator } from '../src/security/PathValidator.js';
import { Skeletonizer } from '../src/ast/Skeletonizer.js';
import { ASTParser } from '../src/ast/ASTParser.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ProjectStateManager } from '../src/server/ProjectStateManager.js';
import type { ServerContext } from '../src/tools/context.js';
import type { RepoRegistry } from '../src/tools/cross-repo-search.js';
import type { BudgetEnvelope } from '../src/budget/budget.js';
import type { VectorStore } from '../src/db/VectorStore.js';

const mockRegistry = {
  list: () => [],
  findByAlias: () => null,
  findByPath: () => null,
} as unknown as RepoRegistry;

let sharedSkeletonizer: Skeletonizer;
let sharedParser: ASTParser;
beforeAll(async () => {
  sharedParser = new ASTParser();
  await sharedParser.init();
  sharedSkeletonizer = new Skeletonizer();
  sharedSkeletonizer.setParser(sharedParser);
}, 60_000);

/**
 * Async env helper — must `await fn()` so process.env stays set across
 * the full microtask chain. See B2.2 commit message for why the sync
 * variant silently masks kill-switch bugs.
 */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function parseEnvelope(raw: string): BudgetEnvelope {
  const obj: unknown = JSON.parse(raw);
  if (typeof obj !== 'object' || obj === null || !('data' in obj) || !('meta' in obj)) {
    throw new Error(`Not a BudgetEnvelope: ${raw.slice(0, 200)}`);
  }
  return obj as BudgetEnvelope;
}

/**
 * Minimal in-memory vector store stub. The search tools call
 * store.search() expecting a result list; only the shape matters
 * for budget-surface tests — match quality is irrelevant.
 */
function makeStubStore(matches: Array<{ filePath: string; score: number; content: string }>): VectorStore {
  return {
    search: async () => matches,
  } as unknown as VectorStore;
}

interface Harness {
  tempDir: string;
  registry: ToolRegistry;
  ctx: ServerContext;
  fixture: (name: string, content: string) => string;
  graph: DependencyGraph;
}

function setupHarness(stubMatches: Array<{ filePath: string; score: number; content: string }> = []): Harness {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-b23-'));
  const validator = new PathValidator(tempDir);
  const graph = new DependencyGraph(tempDir, sharedParser);

  const ctx: ServerContext = {
    projectRoot: tempDir,
    dbPath: path.join(tempDir, 'vectors.lancedb'),
    noDefaultMode: false,
    registry: mockRegistry,
    stateManager: new ProjectStateManager({ maxProjects: 5 }),
    getStore: async () => makeStubStore(stubMatches),
    getGraph: async () => graph,
    getParser: async () => sharedParser,
    getSkeletonizer: async () => sharedSkeletonizer,
    getRuleManager: () => { throw new Error('not used in b2.3 tests'); },
    getPathValidator: () => validator,
    isStoreInitialized: () => true,
    isGraphInitialized: () => true,
    isParserInitialized: () => true,
  };

  const registry = new ToolRegistry();
  registerDefinitionTool(registry, ctx);
  registerContextPacketTool(registry, ctx);
  registerSearchTool(registry, ctx);
  registerFullTextSearchTool(registry, ctx);

  return {
    tempDir,
    registry,
    ctx,
    graph,
    fixture: (name, content) => {
      const p = path.join(tempDir, name);
      fs.writeFileSync(p, content);
      return p;
    },
  };
}

// Method/function bodies hold the BODY_SENTINEL string; signatures
// stay clean. Skeletonizer renders signatures verbatim and strips
// bodies, so the sentinel must only appear inside braces — never
// on the same line as a method/function signature, or it travels
// with the signature into the skeleton output.
const BIG_TS_FIXTURE = `
import { readFileSync } from 'fs';
export class UserService {
  method(): number {
${'    const x = "BODY_SENTINEL_BODY_SENTINEL_BODY_SENTINEL";\n'.repeat(30)}
    return 1;
  }
}
export function formatUser(): string {
${'  const x = "BODY_SENTINEL_BODY_SENTINEL_BODY_SENTINEL";\n'.repeat(30)}
  return "fmt";
}
`;

// Build a string big enough to blow a tight budget for the search tools
// where the response is structural XML (not source).
const BIG_SNIPPET = 'x'.repeat(800);

// ─── ctx_get_definition ──────────────────────────────────────────────

describe('ctx_get_definition — B2.3 budget integration', () => {
  let h: Harness;

  beforeEach(async () => {
    h = setupHarness();
    // Seed the graph with a file that has a class definition the
    // lookup can find. The graph's lookupSymbol returns rows from
    // its symbol table, which is populated by build().
    h.fixture('big.ts', BIG_TS_FIXTURE);
    await h.graph.buildFromDirectory(h.tempDir);
  });

  afterEach(() => fs.rmSync(h.tempDir, { recursive: true, force: true }));

  it('back-compat: raw XML, no envelope, when no budget args', async () => {
    const result = await h.registry.dispatch('ctx_get_definition', { symbol: 'UserService' });
    expect(result).toContain('<definitions');
    expect(() => parseEnvelope(result)).toThrow();
  });

  it('under budget → format=full', async () => {
    const result = await h.registry.dispatch('ctx_get_definition', {
      symbol: 'UserService',
      max_response_tokens: 1000,
    });
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('full');
    expect(env.data).toContain('UserService');
  });

  it('over budget → format=truncated, fallback_reason=skeleton_failed (no skeleton for this tool)', async () => {
    // Force a tiny budget; even the short definition XML will breach.
    const result = await h.registry.dispatch('ctx_get_definition', {
      symbol: 'UserService',
      max_response_tokens: 5,
    });
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('truncated');
    expect(env.meta.fallback_reason).toBe('skeleton_failed');
  });

  it('on_budget_exceeded=error → throws structured Error', async () => {
    await expect(
      h.registry.dispatch('ctx_get_definition', {
        symbol: 'UserService',
        max_response_tokens: 5,
        on_budget_exceeded: 'error',
      }),
    ).rejects.toThrow(/exceeds max_response_tokens=5/);
  });

  it('CTXLOOM_DISABLE_BUDGET=1 → kill switch bypasses everything', async () => {
    const result = await withEnv({ CTXLOOM_DISABLE_BUDGET: '1' }, () =>
      h.registry.dispatch('ctx_get_definition', {
        symbol: 'UserService',
        max_response_tokens: 5,
        on_budget_exceeded: 'error',
      }),
    );
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('full');
  });

  it('format=full propagates original/returned token estimates', async () => {
    const result = await h.registry.dispatch('ctx_get_definition', {
      symbol: 'UserService',
      max_response_tokens: 1000,
    });
    const env = parseEnvelope(result);
    expect(env.meta.original_tokens_est).toBeGreaterThan(0);
    expect(env.meta.returned_tokens_est).toBe(env.meta.original_tokens_est);
  });
});

// ─── ctx_get_context_packet ──────────────────────────────────────────

describe('ctx_get_context_packet — B2.3 budget integration', () => {
  let h: Harness;

  beforeEach(async () => {
    h = setupHarness();
    h.fixture('big.ts', BIG_TS_FIXTURE);
    await h.graph.buildFromDirectory(h.tempDir);
  });

  afterEach(() => fs.rmSync(h.tempDir, { recursive: true, force: true }));

  it('back-compat: raw XML, no envelope, when no budget args', async () => {
    const result = await h.registry.dispatch('ctx_get_context_packet', { target_file: 'big.ts' });
    expect(result).toContain('<context_packet');
    expect(() => parseEnvelope(result)).toThrow();
  });

  it('under budget → format=full', async () => {
    const result = await h.registry.dispatch('ctx_get_context_packet', {
      target_file: 'big.ts',
      max_response_tokens: 10000,
    });
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('full');
    expect(env.data).toContain('BODY_SENTINEL_BODY_SENTINEL_BODY_SENTINEL'); // full primary present
  });

  it('over budget → format=skeleton, primary file body stripped, UserService still visible', async () => {
    // Budget chosen so the full packet (1000+ tokens with the padded
    // fixture) is over budget but the skeleton (UserService class
    // sig + formatUser sig + dep/importer scaffolding) fits under.
    const result = await h.registry.dispatch('ctx_get_context_packet', {
      target_file: 'big.ts',
      max_response_tokens: 600,
    });
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('skeleton');
    expect(env.meta.fallback_reason).toBe('budget_exceeded');
    expect(env.data).toContain('UserService');
    expect(env.data).not.toContain('BODY_SENTINEL_BODY_SENTINEL_BODY_SENTINEL');
  });

  it('on_budget_exceeded=error → throws structured Error', async () => {
    await expect(
      h.registry.dispatch('ctx_get_context_packet', {
        target_file: 'big.ts',
        max_response_tokens: 5,
        on_budget_exceeded: 'error',
      }),
    ).rejects.toThrow(/exceeds max_response_tokens=5/);
  });

  it('CTXLOOM_DISABLE_BUDGET=1 → kill switch bypasses everything', async () => {
    const result = await withEnv({ CTXLOOM_DISABLE_BUDGET: '1' }, () =>
      h.registry.dispatch('ctx_get_context_packet', {
        target_file: 'big.ts',
        max_response_tokens: 5,
        on_budget_exceeded: 'error',
      }),
    );
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('full');
  });

  it('format=skeleton makes original > returned tokens', async () => {
    const result = await h.registry.dispatch('ctx_get_context_packet', {
      target_file: 'big.ts',
      max_response_tokens: 600,
    });
    const env = parseEnvelope(result);
    expect(env.meta.original_tokens_est).toBeGreaterThan(env.meta.returned_tokens_est);
  });
});

// ─── ctx_search ──────────────────────────────────────────────────────

describe('ctx_search — B2.3 budget integration', () => {
  let h: Harness;

  beforeEach(async () => {
    // Stub the vector store with results whose content snippets are
    // big enough to blow a tight budget.
    h = setupHarness([
      { filePath: 'a.ts', score: 0.1, content: BIG_SNIPPET },
      { filePath: 'b.ts', score: 0.2, content: BIG_SNIPPET },
      { filePath: 'c.ts', score: 0.3, content: BIG_SNIPPET },
    ]);
    h.fixture('a.ts', 'export const a = 1;\n');
    h.fixture('b.ts', 'export const b = 2;\n');
    h.fixture('c.ts', 'export const c = 3;\n');
    await h.graph.buildFromDirectory(h.tempDir);
  });

  afterEach(() => fs.rmSync(h.tempDir, { recursive: true, force: true }));

  it('back-compat: raw XML, no envelope', async () => {
    const result = await h.registry.dispatch('ctx_search', { query: 'foo' });
    expect(result).toContain('<search_results');
    expect(() => parseEnvelope(result)).toThrow();
  });

  it('under budget → format=full, content snippets present', async () => {
    const result = await h.registry.dispatch('ctx_search', { query: 'foo', max_response_tokens: 10000 });
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('full');
    expect(env.data).toContain('xxxxx'); // snippet content survived
  });

  it('over budget → format=skeleton, snippet content stripped, file paths kept', async () => {
    const result = await h.registry.dispatch('ctx_search', { query: 'foo', max_response_tokens: 60 });
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('skeleton');
    expect(env.meta.fallback_reason).toBe('budget_exceeded');
    expect(env.data).toContain('a.ts');
    expect(env.data).not.toContain('xxxxx');
  });

  it('on_budget_exceeded=error → throws', async () => {
    await expect(
      h.registry.dispatch('ctx_search', {
        query: 'foo',
        max_response_tokens: 5,
        on_budget_exceeded: 'error',
      }),
    ).rejects.toThrow(/exceeds max_response_tokens=5/);
  });

  it('CTXLOOM_DISABLE_BUDGET=1 → kill switch bypasses everything', async () => {
    const result = await withEnv({ CTXLOOM_DISABLE_BUDGET: '1' }, () =>
      h.registry.dispatch('ctx_search', {
        query: 'foo',
        max_response_tokens: 5,
        on_budget_exceeded: 'error',
      }),
    );
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('full');
  });

  it('format=skeleton makes original > returned tokens', async () => {
    const result = await h.registry.dispatch('ctx_search', { query: 'foo', max_response_tokens: 60 });
    const env = parseEnvelope(result);
    expect(env.meta.original_tokens_est).toBeGreaterThan(env.meta.returned_tokens_est);
  });
});

// ─── ctx_full_text_search ────────────────────────────────────────────

describe('ctx_full_text_search — B2.3 budget integration', () => {
  let h: Harness;

  beforeEach(async () => {
    h = setupHarness();
    // Each file has the search term `needle` plus a lot of padding
    // around it so the captured snippet is large.
    const BIG = ['needle', 'x'.repeat(400)].join('\n');
    h.fixture('a.ts', BIG);
    h.fixture('b.ts', BIG);
    h.fixture('c.ts', BIG);
    await h.graph.buildFromDirectory(h.tempDir);
  });

  afterEach(() => fs.rmSync(h.tempDir, { recursive: true, force: true }));

  it('back-compat: raw XML, no envelope', async () => {
    const result = await h.registry.dispatch('ctx_full_text_search', { query: 'needle', mode: 'keyword' });
    expect(result).toContain('<full_text_search');
    expect(() => parseEnvelope(result)).toThrow();
  });

  it('under budget → format=full, snippets present', async () => {
    const result = await h.registry.dispatch('ctx_full_text_search', {
      query: 'needle',
      mode: 'keyword',
      max_response_tokens: 10000,
    });
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('full');
    expect(env.data).toContain('<match>');
  });

  it('over budget → format=skeleton, match snippets stripped, file paths + counts kept', async () => {
    // Budget chosen so the full snippets are over but the path+count
    // skeleton (3 results × ~30 chars each + ~120-char wrapper) fits.
    const result = await h.registry.dispatch('ctx_full_text_search', {
      query: 'needle',
      mode: 'keyword',
      max_response_tokens: 120,
    });
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('skeleton');
    expect(env.meta.fallback_reason).toBe('budget_exceeded');
    expect(env.data).toContain('a.ts');
    expect(env.data).toContain('matches="1"');
    expect(env.data).not.toContain('<match>');
  });

  it('on_budget_exceeded=error → throws', async () => {
    await expect(
      h.registry.dispatch('ctx_full_text_search', {
        query: 'needle',
        mode: 'keyword',
        max_response_tokens: 5,
        on_budget_exceeded: 'error',
      }),
    ).rejects.toThrow(/exceeds max_response_tokens=5/);
  });

  it('CTXLOOM_DISABLE_BUDGET=1 → kill switch bypasses everything', async () => {
    const result = await withEnv({ CTXLOOM_DISABLE_BUDGET: '1' }, () =>
      h.registry.dispatch('ctx_full_text_search', {
        query: 'needle',
        mode: 'keyword',
        max_response_tokens: 5,
        on_budget_exceeded: 'error',
      }),
    );
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('full');
  });

  it('format=skeleton makes original > returned tokens', async () => {
    const result = await h.registry.dispatch('ctx_full_text_search', {
      query: 'needle',
      mode: 'keyword',
      max_response_tokens: 120,
    });
    const env = parseEnvelope(result);
    expect(env.meta.original_tokens_est).toBeGreaterThan(env.meta.returned_tokens_est);
  });
});
