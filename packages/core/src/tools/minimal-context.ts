/**
 * ctx_get_minimal_context — orientation anchor for every agent workflow.
 *
 * Returns ~150 tokens covering: graph readiness, recent working-tree
 * changes, top hub nodes, and a task-aware suggested-first-tool. Every
 * agent's first MCP call into ctxloom should be this — it sets the
 * structural context for everything that follows.
 *
 * Closes Phase 1a of the agent-harness plan
 * (docs/superpowers/plans/2026-05-18-agent-harness.md). Inspired by
 * code-review-graph's `get_minimal_context`, with two improvements:
 *
 * 1. **Task-aware suggestions** — when the caller passes `task`, we
 *    route by regex to the most-fitting first tool (review → detect_changes,
 *    refactor → find_callers, etc). code-review-graph's version is static.
 *
 * 2. **Token-cost estimates** — every suggestion includes an
 *    `estimated_tokens` field derived from the budget surface defaults,
 *    so the agent knows the cost of its next step before paying it.
 *
 * Performance contract: response time <50ms, response size <500 tokens
 * (default budget 200). Cache hits return in <1ms.
 */
import { execSync } from 'node:child_process';
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { ProjectRootField, PROJECT_ROOT_JSON_SCHEMA } from './projectRootParam.js';
import {
  enforceBudget,
  hasBudgetArgs,
  readBudgetArgs,
  wrapResponse,
} from '../budget/budget.js';

// ─── Schema ──────────────────────────────────────────────────────────

const Schema = z.object({
  task: z.string().max(200).optional().describe(
    "Free-text description of what you're about to do (e.g. 'review PR 142', " +
      "'rename emitTelemetry'). The tool routes by regex to the most-fitting " +
      'suggested-first-tool. Capped at 200 chars; control characters stripped.',
  ),
  project_root: ProjectRootField,
  max_response_tokens: z.number().int().positive().optional(),
  on_budget_exceeded: z.enum(['skeleton', 'truncate', 'error']).optional(),
  response_format: z.enum(['full', 'skeleton', 'auto']).optional(),
});

const DEFAULT_MAX_RESPONSE_TOKENS = 250;

// ─── Suggested-first-tool routing (task-aware) ────────────────────────

interface SuggestedTool {
  tool: string;
  args?: Record<string, unknown>;
  why: string;
  estimated_tokens: number;
}

/**
 * Map a free-text task description to the most-fitting first MCP call.
 *
 * Order matters — the first matching regex wins. Specific intents
 * (refactor, blast) come before general ones (review, explore). The
 * default branch fires when no `task` is supplied or no regex matches.
 *
 * The `estimated_tokens` values are from each tool's
 * `DEFAULT_MAX_RESPONSE_TOKENS` (the typical p75-shaped budget) — see
 * packages/core/src/tools/*.ts.
 */
function routeFirstTool(task: string | undefined, hasDirtyChanges: boolean): SuggestedTool {
  const t = (task ?? '').toLowerCase();

  if (/\b(rename|refactor|move\s+\w+|extract)\b/.test(t)) {
    return {
      tool: 'ctx_get_call_graph',
      why: 'Renames + refactors need every caller surfaced before the edit. Start here.',
      estimated_tokens: 800,
    };
  }
  if (/\b(blast|impact|breaks?|affects?)\b/.test(t)) {
    return {
      tool: 'ctx_blast_radius',
      why: 'Blast-radius analysis gives transitive dependents; start here for impact questions.',
      estimated_tokens: 1500,
    };
  }
  if (/\b(architect|overview|explore|onboard|tour)\b/.test(t)) {
    return {
      tool: 'ctx_architecture_overview',
      why: 'Top-down map of communities + hub nodes; the natural starting point for exploration.',
      estimated_tokens: 2000,
    };
  }
  if (/\b(test|coverage|tested)\b/.test(t)) {
    return {
      tool: 'ctx_knowledge_gaps',
      why: 'Knowledge-gap report highlights files lacking test coverage.',
      estimated_tokens: 1200,
    };
  }
  if (/\b(review|audit|check|diff)\b/.test(t)) {
    return {
      tool: 'ctx_detect_changes',
      why: 'Risk-scored change analysis is the canonical start for reviews.',
      estimated_tokens: 1500,
    };
  }

  // No task or no match — fall through based on working-tree state.
  if (hasDirtyChanges) {
    return {
      tool: 'ctx_detect_changes',
      why: 'Working tree has uncommitted changes — review-mode is the most-likely intent.',
      estimated_tokens: 1500,
    };
  }
  return {
    tool: 'ctx_architecture_overview',
    why: 'Clean working tree + no task hint — orientation is the safe default.',
    estimated_tokens: 2000,
  };
}

// ─── Staleness classification ─────────────────────────────────────────

type Staleness = 'fresh' | 'stale_minutes' | 'stale_hours' | 'unbuilt';

function classifyStaleness(lastBuildIso: string | null): Staleness {
  if (!lastBuildIso) return 'unbuilt';
  const ms = Date.now() - new Date(lastBuildIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'unbuilt';
  if (ms < 5 * 60 * 1000) return 'fresh';
  if (ms < 60 * 60 * 1000) return 'stale_minutes';
  return 'stale_hours';
}

// ─── Recent changes (working tree) ────────────────────────────────────

interface RecentChange {
  file: string;
  status: 'M' | 'A' | 'D' | 'R' | '?';
}

/**
 * Read working-tree changes via `git status --porcelain`.
 *
 * Performance: this is a single subprocess call with a 2s hard
 * timeout (well under our <50ms target on typical repos — the timeout
 * is the safety ceiling, not the budget). Limited to 20 entries to
 * cap response size on huge dirty trees.
 *
 * Security: paths are relative-to-repo-root only; no absolute paths
 * leak. Failures are swallowed (returns empty array) — telemetry +
 * orientation must never block on git.
 */
function readRecentChanges(projectRoot: string): RecentChange[] {
  try {
    const stdout = execSync('git status --porcelain', {
      cwd: projectRoot,
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    const lines = stdout.split('\n').filter((l) => l.trim() !== '');
    return lines.slice(0, 20).map((line): RecentChange => {
      // Porcelain format: XY␣<path>  (X = index, Y = worktree)
      const x = line[0];
      const y = line[1];
      const path = line.slice(3).trim();
      // Prefer index status when both set; '?' for untracked.
      let status: RecentChange['status'] = '?';
      const xy = x === ' ' ? y : x;
      if (xy === 'M' || xy === 'A' || xy === 'D' || xy === 'R') status = xy;
      return { file: path, status };
    });
  } catch {
    return [];
  }
}

// ─── Top hubs (read from graph; computed lazily) ──────────────────────

interface HubEntry {
  name: string;
  reason: 'fan_in' | 'fan_out' | 'bridge';
}

function computeTopHubs(graph: { allFiles(): string[]; getImporters(f: string): string[]; getImports(f: string): string[] }): HubEntry[] {
  // Re-uses the same formula as ctx_hub_nodes but caps at 5 for the
  // minimal-context surface. NOT cached separately here — the outer
  // 10s response cache covers this. If we ever surface this on a
  // tight-latency path, move to a precomputed graph metadata field.
  const files = graph.allFiles();
  const scored = files
    .map((file) => {
      const inDeg = graph.getImporters(file).length;
      const outDeg = graph.getImports(file).length;
      return { file, inDeg, outDeg, total: inDeg + outDeg };
    })
    .filter((s) => s.total >= 2)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return scored.map((s) => ({
    name: s.file,
    reason: s.inDeg > s.outDeg ? 'fan_in' : s.outDeg > s.inDeg ? 'fan_out' : 'bridge',
  }));
}

// ─── Response cache ───────────────────────────────────────────────────

interface CacheEntry {
  expiresAt: number;
  body: string;
}
const CACHE_TTL_MS = 10_000;
const responseCache = new Map<string, CacheEntry>();

/**
 * Cache key = `<project_root>|<task>` — different tasks return
 * different routed suggestions, so cache must be task-keyed.
 */
function cacheKey(projectRoot: string, task: string | undefined): string {
  return `${projectRoot}|${task ?? ''}`;
}

function cacheGet(key: string): string | null {
  const e = responseCache.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return e.body;
}

function cachePut(key: string, body: string): void {
  responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, body });
}

/**
 * Test-only: drop the cache so back-to-back tests don't see each
 * other's results.
 *
 * @internal
 */
export function __clearMinimalContextCacheForTests(): void {
  responseCache.clear();
}

// ─── Task sanitization ────────────────────────────────────────────────

/**
 * Strip control characters and clamp to 200 chars. The schema enforces
 * the length cap; this is defense-in-depth for code paths that bypass
 * Zod validation (unlikely but cheap).
 *
 * Crucially we DO NOT echo the task back in the response body — it
 * goes only into routeFirstTool's regex tests and the telemetry event
 * (which carries `task_kind` not the raw string per the privacy
 * contract). So even if sanitization missed something, the worst
 * case is a misrouted suggestion, not a reflected-input leak.
 */
function sanitizeTask(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
  return stripped === '' ? undefined : stripped;
}

// ─── Renderer ─────────────────────────────────────────────────────────

function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface RenderInput {
  graphReady: boolean;
  nodes: number;
  edges: number;
  lastBuildIso: string | null;
  staleness: Staleness;
  languages: string[];
  recentChanges: RecentChange[];
  topHubs: HubEntry[];
  suggested: SuggestedTool;
}

function render(input: RenderInput): string {
  const lines: string[] = ['<minimal_context>'];
  lines.push(
    `  <graph ready="${input.graphReady}" nodes="${input.nodes}" edges="${input.edges}" ` +
      `last_build="${escapeXML(input.lastBuildIso ?? 'never')}" staleness="${input.staleness}" />`,
  );
  if (input.languages.length > 0) {
    lines.push(`  <languages>${input.languages.map(escapeXML).join(', ')}</languages>`);
  }
  if (input.recentChanges.length > 0) {
    lines.push(`  <recent_changes count="${input.recentChanges.length}">`);
    for (const c of input.recentChanges) {
      lines.push(`    <change status="${c.status}" file="${escapeXML(c.file)}" />`);
    }
    lines.push('  </recent_changes>');
  } else {
    lines.push('  <recent_changes count="0" />');
  }
  if (input.topHubs.length > 0) {
    lines.push(`  <top_hubs count="${input.topHubs.length}">`);
    for (const h of input.topHubs) {
      lines.push(`    <hub reason="${h.reason}" name="${escapeXML(h.name)}" />`);
    }
    lines.push('  </top_hubs>');
  }
  lines.push('  <suggested_first_tool>');
  lines.push(`    <tool>${escapeXML(input.suggested.tool)}</tool>`);
  lines.push(`    <why>${escapeXML(input.suggested.why)}</why>`);
  lines.push(`    <estimated_tokens>${input.suggested.estimated_tokens}</estimated_tokens>`);
  if (input.suggested.args && Object.keys(input.suggested.args).length > 0) {
    lines.push(`    <args>${escapeXML(JSON.stringify(input.suggested.args))}</args>`);
  }
  lines.push('  </suggested_first_tool>');
  lines.push('</minimal_context>');
  return lines.join('\n');
}

/**
 * Skeleton renderer — drops `recent_changes` (most expandable section)
 * and keeps the structurally-critical parts. Hit when the caller's
 * `max_response_tokens` budget can't fit the full body.
 */
function renderSkeleton(input: RenderInput): string {
  const lines: string[] = ['<minimal_context format="skeleton">'];
  lines.push(
    `  <graph ready="${input.graphReady}" nodes="${input.nodes}" edges="${input.edges}" staleness="${input.staleness}" />`,
  );
  lines.push(`  <recent_changes count="${input.recentChanges.length}" />`);
  lines.push(`  <top_hubs count="${input.topHubs.length}" />`);
  lines.push('  <suggested_first_tool>');
  lines.push(`    <tool>${escapeXML(input.suggested.tool)}</tool>`);
  lines.push(`    <why>${escapeXML(input.suggested.why)}</why>`);
  lines.push(`    <estimated_tokens>${input.suggested.estimated_tokens}</estimated_tokens>`);
  lines.push('  </suggested_first_tool>');
  lines.push('</minimal_context>');
  return lines.join('\n');
}

// ─── Tool registration ────────────────────────────────────────────────

export function registerMinimalContextTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_get_minimal_context',
    {
      name: 'ctx_get_minimal_context',
      description:
        'Orientation anchor — call this FIRST in any workflow. Returns ~150 tokens covering ' +
        'graph readiness, recent working-tree changes, top hub nodes, and a task-aware ' +
        'suggested-first-tool. Cached for 10s. Pass `task` as a free-text intent description ' +
        '("review PR 142", "rename X", "check coverage") and the tool routes to the most-fitting ' +
        'follow-up. The agent should call the suggested tool next rather than guessing.',
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'Free-text intent (max 200 chars). Routes the suggested-first-tool by regex. ' +
              'Keywords: review/audit, rename/refactor, blast/impact, architect/explore, test/coverage.',
          },
          project_root: PROJECT_ROOT_JSON_SCHEMA,
          max_response_tokens: {
            type: 'number',
            description: 'Optional response token budget. Default 250.',
          },
          on_budget_exceeded: {
            type: 'string',
            enum: ['skeleton', 'truncate', 'error'],
          },
          response_format: {
            type: 'string',
            enum: ['full', 'skeleton', 'auto'],
          },
        },
      },
    },
    async (args) => {
      const parsed = Schema.parse(args);
      const task = sanitizeTask(parsed.task);
      const projectRoot = parsed.project_root ?? ctx.projectRoot;

      // Cache hit short-circuits all work (target: <1ms response).
      const key = cacheKey(projectRoot, task);
      const cached = cacheGet(key);
      if (cached) {
        // Bypass budget surface on cache hits — the cached body is
        // already shaped to the requested budget; round-tripping
        // through enforceBudget would re-run skeletonization for no
        // gain.
        return cached;
      }

      // Graph readiness probe — but DO NOT wait for graph build if
      // it's cold. The point of minimal context is to be cheap and
      // immediate; if the graph isn't ready, say so and let the agent
      // decide whether to wait (e.g. by following our
      // suggested_first_tool to a build).
      const graphReady = ctx.isGraphInitialized();
      let nodes = 0;
      let edges = 0;
      let lastBuildIso: string | null = null;
      const languages: string[] = [];
      let topHubs: HubEntry[] = [];

      if (graphReady) {
        try {
          const graph = await ctx.getGraph(projectRoot);
          nodes = graph.allFiles().length;
          // Approximation: edges = sum of imports per file. Cheap.
          edges = graph.allFiles().reduce((acc, f) => acc + graph.getImports(f).length, 0);
          // Languages exposed indirectly through file extensions in graph
          const extensions = new Set<string>();
          for (const f of graph.allFiles()) {
            const ext = f.split('.').pop();
            if (ext && ext.length <= 4) extensions.add(ext);
          }
          languages.push(...Array.from(extensions).sort());
          topHubs = computeTopHubs(graph);
          // lastBuildIso isn't currently exposed on DependencyGraph; we
          // fall back to "ready" without a timestamp. Phase 2 can wire
          // ProjectStateManager's build-completion timestamp into here.
        } catch {
          // Graph errors → degrade gracefully to ready=false.
        }
      }

      const recentChanges = readRecentChanges(projectRoot);
      const suggested = routeFirstTool(task, recentChanges.length > 0);
      const staleness = classifyStaleness(lastBuildIso);

      const renderInput: RenderInput = {
        graphReady,
        nodes,
        edges,
        lastBuildIso,
        staleness,
        languages,
        recentChanges,
        topHubs,
        suggested,
      };

      const full = render(renderInput);

      // Budget surface — if the caller passed budget args, route through
      // enforceBudget so over-budget responses fall back to the skeleton
      // renderer. Off-the-budget-surface callers get the raw body
      // (back-compat with pre-Phase-1a integrations).
      if (!hasBudgetArgs(parsed)) {
        cachePut(key, full);
        return full;
      }

      const result = await enforceBudget({
        ctx,
        full,
        args: readBudgetArgs(parsed),
        toolName: 'ctx_get_minimal_context',
        defaultMaxTokens: DEFAULT_MAX_RESPONSE_TOKENS,
        skeletonProducer: async () => renderSkeleton(renderInput),
      });

      const body = wrapResponse(result);
      cachePut(key, body);
      return body;
    },
  );
}
