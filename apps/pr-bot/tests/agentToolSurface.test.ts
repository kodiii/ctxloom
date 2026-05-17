/**
 * Live-registry drift detection for agent specs vs the actual MCP
 * tool surface assembled by `createToolRegistry()`.
 *
 * Closes TEST-131-3 from the PR #131 dogfood review:
 * https://github.com/kodiii/ctxloom/pull/131#issuecomment-4472601506
 *
 * THE GAP THIS CLOSES (vs the existing apps/pr-bot/tests/agents.test.ts)
 *
 * `agents.test.ts` already validates that every `ctx_*` reference in
 * the agent specs (frontmatter + body + bare-`ctx_*` prose) matches
 * a tool name FOUND VIA TEXTUAL GREP of `packages/core/src/tools/*.ts`.
 * That's enough to catch a typo like `ctx_find_callers` (which was
 * the original ARCH-001 failure mode the test was built for).
 *
 * What grep-of-source can't catch:
 *
 *   1. A tool file exists with `name: 'ctx_new_thing'` BUT
 *      `createToolRegistry()` in tools/index.ts forgets to call its
 *      `registerXTool(registry, ctx)`. The textual grep finds the
 *      name; the runtime registry doesn't expose it. Agent specs
 *      that reference it would dispatch to nothing at production
 *      time — silent miss.
 *
 *   2. A tool is registered conditionally (e.g. behind a feature
 *      flag, license check, or runtime env probe). Grep would
 *      find it; the runtime registry doesn't expose it unless the
 *      condition is met. Same silent-miss failure mode.
 *
 * This test asserts every agent-referenced tool resolves against
 * the LIVE registry assembled by the same code path the MCP server
 * uses at boot.
 *
 * Stays in apps/pr-bot/tests/ alongside agents.test.ts so the two
 * sit together as the agent-spec validation cohort.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolRegistry } from '../../../packages/core/src/tools/index.js';
import { ProjectStateManager } from '../../../packages/core/src/server/ProjectStateManager.js';
import type { ServerContext } from '../../../packages/core/src/tools/context.js';
import type { RepoRegistry } from '../../../packages/core/src/tools/cross-repo-search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const AGENTS_DIR = join(REPO_ROOT, 'apps', 'pr-bot', 'examples', '.claude', 'agents');

const mockRegistry = {
  list: () => [],
  findByAlias: () => null,
  findByPath: () => null,
} as unknown as RepoRegistry;

/**
 * Build the registry the same way the MCP server does at boot.
 *
 * Every getter is wired to reject — agent-tool-surface validation
 * only needs the REGISTRY TOPOLOGY (tool name set), never actually
 * dispatches a tool. If a `registerXTool()` call eagerly invoked one
 * of these at registration time (it doesn't today), the test would
 * surface that anti-pattern via a clear "not used" error.
 */
function buildLiveRegistry(): ReturnType<typeof createToolRegistry> {
  const ctx: ServerContext = {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    noDefaultMode: false,
    registry: mockRegistry,
    stateManager: new ProjectStateManager({ maxProjects: 5 }),
    getStore: () => Promise.reject(new Error('not used in surface-validation test')),
    getGraph: () => Promise.reject(new Error('not used in surface-validation test')),
    getParser: () => Promise.reject(new Error('not used in surface-validation test')),
    getSkeletonizer: () => Promise.reject(new Error('not used in surface-validation test')),
    getRuleManager: () => { throw new Error('not used in surface-validation test'); },
    getPathValidator: () => { throw new Error('not used in surface-validation test'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
  };
  return createToolRegistry(ctx);
}

/**
 * Extract every ctx_* tool name referenced by an agent spec.
 * Covers all three reference forms agents.test.ts checks:
 *   - frontmatter `tools:` comma list (mcp__ctxloom__ctx_* form)
 *   - body `mcp__ctxloom__ctx_*` mentions
 *   - body bare-backtick `ctx_*` mentions
 *
 * Returns a Set so duplicates collapse cleanly.
 *
 * @public Exported for unit testing.
 */
export function extractToolRefs(specSource: string): Set<string> {
  const out = new Set<string>();
  // Frontmatter tools: list is just text — capture every
  // mcp__ctxloom__ctx_* occurrence anywhere (covers all three forms).
  const matches = specSource.matchAll(/mcp__ctxloom__(ctx_[a-z_]+)/g);
  for (const m of matches) out.add(m[1]);
  // Bare-backtick form in prose: `ctx_xxx`. Strip the matches inside
  // fenced code blocks first to avoid false positives on doc snippets.
  const stripped = specSource.replace(/```[\s\S]*?```/g, '');
  const bare = stripped.matchAll(/`(ctx_[a-z_]+)`/g);
  for (const m of bare) out.add(m[1]);
  return out;
}

describe('agent-spec tool surface vs live MCP registry', () => {
  let liveToolNames: Set<string>;
  let agentFiles: string[];

  beforeAll(() => {
    const registry = buildLiveRegistry();
    liveToolNames = new Set(registry.list().map((t) => t.name));
    agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));
  });

  it('live registry exposes at least 30 ctx_* tools', () => {
    // Sanity floor — guards against accidental wholesale unregister
    // (e.g. a refactor that breaks createToolRegistry). If the real
    // count drops to single digits, the per-agent tests below would
    // all fail loudly but the cause would be ambiguous; this gives a
    // clear root-cause signal.
    expect(
      liveToolNames.size,
      `Live registry exposes only ${liveToolNames.size} tools — expected 30+. Check createToolRegistry() in packages/core/src/tools/index.ts for missing registerXTool() calls.`,
    ).toBeGreaterThanOrEqual(30);
  });

  it('agent fixtures directory contains at least one .md spec', () => {
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  // Per-agent assertion — every tool the spec references must exist in
  // the LIVE registry. If this fails, three plausible root causes:
  //   1. The agent spec references a tool that was removed (drift)
  //   2. The agent spec references a typo'd tool name
  //   3. A new tool was added to a file under packages/core/src/tools/
  //      but createToolRegistry() in tools/index.ts forgot to call
  //      its registerXTool() — the existing agents.test.ts would
  //      false-pass via grep, this test catches it.
  it.each(['security-reviewer.md', 'architecture-reviewer.md', 'testing-reviewer.md', 'performance-reviewer.md', 'review-orchestrator.md'])(
    '%s: every referenced ctx_* tool exists in the live registry',
    (file) => {
      const src = readFileSync(join(AGENTS_DIR, file), 'utf8');
      const referenced = extractToolRefs(src);
      const missing: string[] = [];
      for (const tool of referenced) {
        if (!liveToolNames.has(tool)) missing.push(tool);
      }
      expect(
        missing,
        `${file} references tool(s) not exposed by the live MCP registry: [${missing.join(', ')}]. ` +
        `Either the agent spec drifted (rename / remove the reference), or createToolRegistry() ` +
        `in packages/core/src/tools/index.ts is missing the registerXTool() call. ` +
        `Live registry currently exposes ${liveToolNames.size} tools.`,
      ).toEqual([]);
    },
  );
});

// ─── helper self-tests ───────────────────────────────────────────────

describe('extractToolRefs', () => {
  it('extracts from mcp__ctxloom__ frontmatter tools list form', () => {
    const md = `---
tools: mcp__ctxloom__ctx_status, mcp__ctxloom__ctx_get_file
---
body`;
    expect(extractToolRefs(md)).toEqual(new Set(['ctx_status', 'ctx_get_file']));
  });

  it('extracts from mcp__ctxloom__ body prose form', () => {
    const md = 'Call mcp__ctxloom__ctx_search first, then mcp__ctxloom__ctx_blast_radius.';
    expect(extractToolRefs(md)).toEqual(new Set(['ctx_search', 'ctx_blast_radius']));
  });

  it('extracts from bare-backtick prose form (`ctx_*`)', () => {
    const md = 'Prefer `ctx_get_call_graph` over `ctx_get_file` for structural queries.';
    expect(extractToolRefs(md)).toEqual(new Set(['ctx_get_call_graph', 'ctx_get_file']));
  });

  it('deduplicates across forms (mcp__ctxloom__ctx_x === `ctx_x`)', () => {
    const md = `tools: mcp__ctxloom__ctx_status

Prose mentioning \`ctx_status\` again.`;
    expect(extractToolRefs(md)).toEqual(new Set(['ctx_status']));
  });

  it('IGNORES `ctx_*` mentions inside fenced code blocks (doc snippets)', () => {
    // The existing agents.test.ts deliberately strips fences for the
    // bare-backtick check — code blocks often contain JSON keys or
    // legacy examples that intentionally mention removed/renamed
    // tools. We mirror that policy here so this test is not stricter
    // than the existing one (would be confusing).
    const md = `Use \`ctx_search\` in prose.

\`\`\`json
{ "removed_tool": "ctx_find_callers" }
\`\`\``;
    expect(extractToolRefs(md)).toEqual(new Set(['ctx_search']));
  });

  it('returns empty Set for a spec with no tool references', () => {
    expect(extractToolRefs('# Overview\n\nJust prose.')).toEqual(new Set());
  });
});
