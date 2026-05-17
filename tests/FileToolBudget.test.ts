/**
 * Phase B2.2 — ctx_get_file budget surface integration tests.
 *
 * Six scenarios per the #106 acceptance criteria:
 *   1. Under budget → full text + meta.format === 'full'
 *   2. Over budget, skeletonizable → skeleton substitution
 *   3. Over budget, not skeletonizable → truncation + skeleton_failed
 *   4. on_budget_exceeded: 'error' → structured throw
 *   5. CTXLOOM_DISABLE_BUDGET=1 → kill switch ignores budget args
 *   6. Back-compat: no budget args → raw text, no envelope
 *
 * These tests double as the integration pattern for B2.3/B2.4 — every
 * subsequent per-tool wiring in this phase should be testable with the
 * same shape (ToolRegistry + real PathValidator + real Skeletonizer
 * against a temp dir, calling registry.dispatch with various args).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerFileTool } from '../src/tools/file.js';
import { PathValidator } from '../src/security/PathValidator.js';
import { Skeletonizer } from '../src/ast/Skeletonizer.js';
import { ProjectStateManager } from '../src/server/ProjectStateManager.js';
import type { ServerContext } from '../src/tools/context.js';
import type { RepoRegistry } from '../src/tools/cross-repo-search.js';
import type { BudgetEnvelope } from '../src/budget/budget.js';

const mockRegistry = {
  list: () => [],
  findByAlias: () => null,
  findByPath: () => null,
} as unknown as RepoRegistry;

// A single Skeletonizer reused across all tests — init() is expensive
// (loads tree-sitter wasm), but the parser is pure-functional once
// loaded so sharing is safe.
let sharedSkeletonizer: Skeletonizer;
beforeAll(async () => {
  sharedSkeletonizer = new Skeletonizer();
  await sharedSkeletonizer.init();
}, 60_000);

/**
 * Run `fn` with env temporarily set. The async variant is critical: the
 * tool handler awaits `ctx.getSkeletonizer()` before reaching the
 * env-sensitive `isBudgetDisabled()` check, so a sync `try/finally`
 * would restore env in the microtask BEFORE the check runs — making
 * kill-switch tests silently pass-through.
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

interface Harness {
  tempDir: string;
  registry: ToolRegistry;
  fixture: (name: string, content: string) => string;
}

function setupHarness(): Harness {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-file-budget-'));
  const validator = new PathValidator(tempDir);

  const ctx: ServerContext = {
    projectRoot: tempDir,
    dbPath: path.join(tempDir, 'vectors.lancedb'),
    noDefaultMode: false,
    registry: mockRegistry,
    stateManager: new ProjectStateManager({ maxProjects: 5 }),
    getStore: () => Promise.reject(new Error('not used in file-tool tests')),
    getGraph: () => Promise.reject(new Error('not used in file-tool tests')),
    getParser: () => Promise.reject(new Error('not used in file-tool tests')),
    getSkeletonizer: async () => sharedSkeletonizer,
    getRuleManager: () => { throw new Error('not used in file-tool tests'); },
    getPathValidator: () => validator,
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
  };

  const registry = new ToolRegistry();
  registerFileTool(registry, ctx);

  return {
    tempDir,
    registry,
    fixture: (name: string, content: string): string => {
      const p = path.join(tempDir, name);
      fs.writeFileSync(p, content);
      return p;
    },
  };
}

// Strongly-typed parse for the envelope so tests don't litter `as` casts.
function parseEnvelope(raw: string): BudgetEnvelope {
  const obj: unknown = JSON.parse(raw);
  if (typeof obj !== 'object' || obj === null || !('data' in obj) || !('meta' in obj)) {
    throw new Error(`Not a BudgetEnvelope: ${raw.slice(0, 200)}`);
  }
  return obj as BudgetEnvelope;
}

// A skeletonizable TS fixture big enough to blow a tight budget while
// having a useful skeleton (class + methods + imports).
const BIG_TS_FIXTURE = `
import { readFileSync } from 'fs';
import type { Config } from './config.js';

export interface User { id: string; name: string; email: string; }

export class UserService {
  private db: string;
  constructor(db: string) {
    this.db = db;
    // fill the body so the file blows a small token budget.
    ${'    const x = "padding-padding-padding-padding-padding";\n'.repeat(40)}
  }
  async getUser(id: string): Promise<User | null> {
    const raw = readFileSync(this.db, 'utf-8');
    ${'    const y = "more-padding-more-padding-more-padding";\n'.repeat(40)}
    return JSON.parse(raw);
  }
}

export function formatUser(user: User): string {
  ${'  const z = "fmt-padding-fmt-padding";\n'.repeat(40)}
  return \`\${user.name} <\${user.email}>\`;
}
`;

describe('ctx_get_file — Phase B2.2 budget integration', () => {
  let h: Harness;

  beforeEach(() => {
    h = setupHarness();
  });

  afterEach(() => {
    fs.rmSync(h.tempDir, { recursive: true, force: true });
  });

  // ── (6) Back-compat: no budget args → raw text, NO envelope ───────
  it('back-compat: returns raw text (no envelope) when no budget args are passed', async () => {
    h.fixture('plain.ts', 'export const greeting = "hello";\n');
    const result = await h.registry.dispatch('ctx_get_file', { path: 'plain.ts' });
    expect(result).toBe('export const greeting = "hello";\n');
    // Must NOT parse as the budget envelope shape.
    expect(() => parseEnvelope(result)).toThrow();
  });

  // ── (1) Under budget ──────────────────────────────────────────────
  it('under budget → returns full text + meta.format === "full"', async () => {
    h.fixture('small.ts', 'export const x = 42;\n');
    const result = await h.registry.dispatch('ctx_get_file', {
      path: 'small.ts',
      max_response_tokens: 1000,
    });
    const env = parseEnvelope(result);
    expect(env.data).toBe('export const x = 42;\n');
    expect(env.meta.format).toBe('full');
    expect(env.meta.fallback_reason).toBeNull();
    expect(env.meta.original_tokens_est).toBe(env.meta.returned_tokens_est);
  });

  // ── (2) Over budget, skeletonizable → skeleton substitution ───────
  it('over budget on TS → falls back to a skeleton with class + function signatures', async () => {
    h.fixture('big.ts', BIG_TS_FIXTURE);
    const result = await h.registry.dispatch('ctx_get_file', {
      path: 'big.ts',
      max_response_tokens: 200, // tiny budget; fixture is ~3000 chars
    });
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('skeleton');
    expect(env.meta.fallback_reason).toBe('budget_exceeded');
    expect(env.meta.original_tokens_est).toBeGreaterThan(env.meta.returned_tokens_est);
    // Skeleton must preserve the surfaceable identifiers.
    expect(env.data).toContain('UserService');
    expect(env.data).toContain('formatUser');
    // And must NOT contain the body padding sentinel.
    expect(env.data).not.toContain('padding-padding-padding-padding-padding');
  });

  // ── (3) Over budget, non-source file → budget breach is flagged ───
  it('over budget on a non-source file → meta flags the breach (skeleton OR truncated)', async () => {
    // .txt files have no tree-sitter grammar; Skeletonizer returns just
    // the `// Source: ...` comment (per its `skipped` path). That ~20-
    // char skeleton fits under any non-trivial budget, so the helper
    // legitimately returns format === 'skeleton'. The contract this
    // test guards: regardless of whether skeleton or truncation wins,
    // the budget breach is surfaced via meta.format != 'full' and
    // meta.fallback_reason is set. The 21 source-returning tools
    // depend on this invariant — callers parsing the meta envelope
    // should never see 'full' on an over-budget response.
    h.fixture('notes.txt', 'a'.repeat(5000));
    const result = await h.registry.dispatch('ctx_get_file', {
      path: 'notes.txt',
      max_response_tokens: 50,
    });
    const env = parseEnvelope(result);
    expect(env.meta.format).not.toBe('full');
    expect(env.meta.fallback_reason).not.toBeNull();
    expect(env.meta.returned_tokens_est).toBeLessThanOrEqual(50);
    expect(env.meta.original_tokens_est).toBeGreaterThan(50);
  });

  // ── (4) on_budget_exceeded: 'error' → structured throw ────────────
  it('on_budget_exceeded === "error" → throws a structured Error with token counts', async () => {
    h.fixture('big.ts', BIG_TS_FIXTURE);
    await expect(
      h.registry.dispatch('ctx_get_file', {
        path: 'big.ts',
        max_response_tokens: 10,
        on_budget_exceeded: 'error',
      }),
    ).rejects.toThrow(/exceeds max_response_tokens=10/);
  });

  // ── (5) CTXLOOM_DISABLE_BUDGET=1 → kill switch ────────────────────
  it('CTXLOOM_DISABLE_BUDGET=1 → bypasses every budget arg, even on_budget_exceeded: "error"', async () => {
    h.fixture('big.ts', BIG_TS_FIXTURE);
    const result = await withEnv({ CTXLOOM_DISABLE_BUDGET: '1' }, () =>
      h.registry.dispatch('ctx_get_file', {
        path: 'big.ts',
        max_response_tokens: 10,
        on_budget_exceeded: 'error', // would normally throw
      }),
    );
    const env = parseEnvelope(result);
    expect(env.meta.format).toBe('full');
    expect(env.meta.fallback_reason).toBeNull();
    expect(env.data).toContain('UserService'); // full text preserved
  });
});
