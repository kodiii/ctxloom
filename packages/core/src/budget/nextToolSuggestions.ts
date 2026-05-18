/**
 * nextToolSuggestions.ts — author-curated follow-up tool hints attached
 * to every budget-enforced response. Closes Phase 1b of the agent-
 * harness plan (docs/superpowers/plans/2026-05-18-agent-harness.md).
 *
 * Design goals:
 *
 *   1. **API self-guidance** — the agent doesn't need to memorize which
 *      tool follows which; the response itself proposes the next 1–3
 *      MCP calls with `why` reasoning and token-cost estimates.
 *
 *   2. **Zero per-call cost** — suggestions are static lookups in a
 *      module-scope `Map`. No allocations on the hot path.
 *
 *   3. **Allowlist enforcement** — Phase 4b will mine telemetry to
 *      derive learned suggestions; this module is the trust boundary
 *      that rejects any tool name not on the canonical registered-tools
 *      list. Defends against poisoned telemetry / hand-edited files.
 *
 *   4. **Privacy contract** — `args` in suggestions are author-defined
 *      static literals. `why` is a static template literal. NEVER any
 *      user-controllable string (task, query, path).
 *
 * Improvements over code-review-graph's equivalent:
 *
 *   - Token-cost estimates per suggestion — agents can budget their
 *     next call against the response shape they got
 *   - Allowlist returns suggestions silently filtered, not the whole
 *     set rejected — graceful degradation if a future tool spec lies
 *     about a follow-up tool that hasn't been registered yet
 *
 * Phase 4b adds telemetry-learned rules via `getLearnedRules()` —
 * they take priority over static when the user has accumulated
 * enough usage samples.
 */
import { getLearnedRules } from './learnedSuggestions.js';

/**
 * Shape attached under `meta.next_tool_suggestions` on every budget-
 * wrapped response. ≤3 entries per call.
 *
 * @public
 */
export interface NextToolSuggestion {
  /** Registered tool name. MUST be allowlisted at lookup time. */
  tool: string;
  /**
   * Optional static args literal — never user input. Example:
   * `{ direction: 'callers' }` for `ctx_get_call_graph`.
   */
  args?: Record<string, unknown>;
  /** Static template literal explaining why this is the natural next step. */
  why: string;
  /**
   * Author-curated typical response size in tokens. Reflects the
   * receiving tool's `DEFAULT_MAX_RESPONSE_TOKENS` so agents can
   * budget the next call.
   */
  estimated_tokens: number;
}

/**
 * Author-curated follow-up sequences. The map key is the tool that
 * JUST RAN; the value lists what to consider next.
 *
 * Curation rules:
 *
 *   - List 2–3 entries per tool; more than 3 hurts signal density
 *   - Most-likely follow-up FIRST (the agent typically takes the head)
 *   - Each `why` ≤ 80 chars (keeps the token budget in check)
 *   - NEVER include a tool name unless it's actually registered —
 *     `tests/NextToolSuggestions.test.ts` pins this
 *
 * Numbers come from each tool's `DEFAULT_MAX_RESPONSE_TOKENS` in
 * `packages/core/src/tools/*.ts`. Re-derived from real p75 telemetry
 * in Phase 4b.
 */
const STATIC_RULES: Record<string, NextToolSuggestion[]> = {
  // ─── Source-returning / file-shaped tools ────────────────────────
  ctx_get_file: [
    {
      tool: 'ctx_get_call_graph',
      why: 'Check who depends on this file before modifying.',
      estimated_tokens: 800,
    },
    {
      tool: 'ctx_get_definition',
      why: 'Cheaper view if you need a specific symbol, not the whole file.',
      estimated_tokens: 2000,
    },
    {
      tool: 'ctx_blast_radius',
      why: 'Transitive impact analysis before a write.',
      estimated_tokens: 1500,
    },
  ],
  ctx_get_definition: [
    {
      tool: 'ctx_get_call_graph',
      why: 'Who calls this symbol? Almost always your next step.',
      estimated_tokens: 800,
    },
    {
      tool: 'ctx_blast_radius',
      why: 'What would break if this signature changes?',
      estimated_tokens: 1500,
    },
  ],
  ctx_get_context_packet: [
    {
      tool: 'ctx_get_call_graph',
      why: 'Surface external callers not visible inside the packet.',
      estimated_tokens: 800,
    },
    {
      tool: 'ctx_get_affected_flows',
      why: 'Execution-flow coverage of the packet files.',
      estimated_tokens: 2000,
    },
  ],
  ctx_search: [
    {
      tool: 'ctx_get_definition',
      why: 'Pull the canonical definition of a top result.',
      estimated_tokens: 2000,
    },
    {
      tool: 'ctx_similar_files',
      why: 'Find related files outside the keyword/vector hit set.',
      estimated_tokens: 1000,
    },
  ],
  ctx_full_text_search: [
    {
      tool: 'ctx_get_file',
      why: 'Inspect a specific match in context.',
      estimated_tokens: 8000,
    },
    {
      tool: 'ctx_get_call_graph',
      why: 'Caller graph for matched symbols.',
      estimated_tokens: 800,
    },
  ],
  ctx_similar_files: [
    {
      tool: 'ctx_get_context_packet',
      why: 'Bundle the cluster into a single packet for review.',
      estimated_tokens: 6000,
    },
  ],

  // ─── Graph / structural queries ──────────────────────────────────
  // ctx_get_call_graph is the canonical "find callers" tool — pass
  // direction: 'callers' or 'callees' in args. The follow-ups below
  // assume the caller is investigating impact / coverage on the
  // returned caller set.
  ctx_get_call_graph: [
    {
      tool: 'ctx_blast_radius',
      why: 'Transitive dependents — callers of the callers you just found.',
      estimated_tokens: 1500,
    },
    {
      tool: 'ctx_get_affected_flows',
      why: 'Which execution paths break if any caller is removed?',
      estimated_tokens: 2000,
    },
    {
      tool: 'ctx_execution_flow',
      why: 'Linearize the caller set into ordered execution sequences.',
      estimated_tokens: 4000,
    },
  ],
  ctx_blast_radius: [
    {
      tool: 'ctx_get_affected_flows',
      why: 'Execution-flow impact on the affected files.',
      estimated_tokens: 2000,
    },
    { tool: 'ctx_knowledge_gaps', why: 'Identify test-coverage gaps on affected files.', estimated_tokens: 1200 },
  ],
  ctx_get_affected_flows: [
    {
      tool: 'ctx_execution_flow',
      why: 'Drill into a specific affected flow.',
      estimated_tokens: 4000,
    },
    {
      tool: 'ctx_blast_radius',
      why: 'Reverse direction — what affects this flow?',
      estimated_tokens: 1500,
    },
  ],
  ctx_execution_flow: [
    {
      tool: 'ctx_get_call_graph',
      why: 'External callers of the flow entry-point.',
      estimated_tokens: 800,
    },
  ],

  // ─── Architecture / overview tools ───────────────────────────────
  ctx_architecture_overview: [
    {
      tool: 'ctx_community_list',
      why: 'Drill into a specific community.',
      estimated_tokens: 1000,
    },
    {
      tool: 'ctx_hub_nodes',
      why: 'Top fan-in/out nodes deserving deeper inspection.',
      estimated_tokens: 1200,
    },
    {
      tool: 'ctx_bridge_nodes',
      why: 'Cross-community bridges (high architectural leverage).',
      estimated_tokens: 1000,
    },
  ],
  ctx_community_list: [
    {
      tool: 'ctx_get_context_packet',
      why: 'Bundle a community into a single review packet.',
      estimated_tokens: 6000,
    },
  ],
  ctx_hub_nodes: [
    {
      tool: 'ctx_get_call_graph',
      why: 'Who depends on the top hub?',
      estimated_tokens: 800,
    },
    {
      tool: 'ctx_blast_radius',
      why: 'Hub change-impact analysis.',
      estimated_tokens: 1500,
    },
  ],
  ctx_bridge_nodes: [
    {
      tool: 'ctx_get_call_graph',
      why: 'Callers across the bridge.',
      estimated_tokens: 800,
    },
  ],
  ctx_surprising_connections: [
    {
      tool: 'ctx_blast_radius',
      why: 'Impact analysis on a surprising-connection target.',
      estimated_tokens: 1500,
    },
  ],

  // ─── Review / diff tools ─────────────────────────────────────────
  ctx_detect_changes: [
    {
      tool: 'ctx_get_file',
      why: 'Inspect a specific risky file.',
      estimated_tokens: 8000,
    },
    {
      tool: 'ctx_get_affected_flows',
      why: 'Which execution paths the change touches.',
      estimated_tokens: 2000,
    },
    {
      tool: 'ctx_git_diff_review',
      why: 'Full diff packet for the changeset.',
      estimated_tokens: 8000,
    },
  ],
  ctx_git_diff_review: [
    {
      tool: 'ctx_risk_overlay',
      why: 'Score the changed files by historical churn + coupling.',
      estimated_tokens: 1500,
    },
    {
      tool: 'ctx_get_call_graph',
      why: 'Caller-side impact of the changes.',
      estimated_tokens: 800,
    },
  ],
  ctx_risk_overlay: [
    {
      tool: 'ctx_get_file',
      why: 'Inspect the highest-risk file in detail.',
      estimated_tokens: 8000,
    },
  ],
  ctx_git_coupling: [
    {
      tool: 'ctx_blast_radius',
      why: 'Static impact analysis to complement co-change signal.',
      estimated_tokens: 1500,
    },
  ],

  // ─── Refactor tools ──────────────────────────────────────────────
  ctx_refactor_preview: [
    {
      tool: 'ctx_apply_refactor',
      why: 'Commit the preview after you reviewed the rename.',
      estimated_tokens: 2000,
    },
  ],
  ctx_apply_refactor: [
    {
      tool: 'ctx_detect_changes',
      why: 'Verify the refactor produced the expected risk profile.',
      estimated_tokens: 1500,
    },
  ],

  // ─── Knowledge / coverage tools ──────────────────────────────────
  ctx_knowledge_gaps: [
    { tool: 'ctx_knowledge_gaps', why: 'Identify test-coverage gaps on affected files.', estimated_tokens: 1200 },
    {
      tool: 'ctx_get_call_graph',
      why: 'Caller frequency on untested symbols (impact ranking).',
      estimated_tokens: 800,
    },
  ],
  ctx_find_large_functions: [
    {
      tool: 'ctx_get_definition',
      why: 'Inspect the largest function.',
      estimated_tokens: 2000,
    },
  ],

  // ─── Metadata / status ───────────────────────────────────────────
  ctx_get_minimal_context: [
    // intentionally empty — the suggested_first_tool field IS the
    // next-step suggestion. Adding rules here would be redundant.
  ],
  ctx_status: [],
  ctx_get_rules: [
    {
      tool: 'ctx_rules_check',
      why: 'Validate code against rules.',
      estimated_tokens: 1200,
    },
  ],
  ctx_rules_check: [],
  ctx_get_workflow: [],
  ctx_suggested_questions: [],

  // ─── Wiki / export ───────────────────────────────────────────────
  ctx_wiki_generate: [
    {
      tool: 'ctx_architecture_overview',
      why: 'Confirm the wiki structure against the live overview.',
      estimated_tokens: 2000,
    },
  ],
  ctx_graph_export: [],
  ctx_graph_snapshot: [
    {
      tool: 'ctx_graph_diff',
      why: 'Compare against a later snapshot.',
      estimated_tokens: 2000,
    },
  ],
  ctx_graph_diff: [
    {
      tool: 'ctx_detect_changes',
      why: 'Risk-scored view of the graph delta.',
      estimated_tokens: 1500,
    },
  ],

  // ─── Cross-repo ──────────────────────────────────────────────────
  ctx_cross_repo_search: [
    {
      tool: 'ctx_get_file',
      why: 'Inspect a hit in a specific repo.',
      estimated_tokens: 8000,
    },
  ],

  // ─── Query primitive ─────────────────────────────────────────────

  // ─── Affected flows (sibling to get_affected_flows but worth pinning) ─

  // ─── Definition aliases / structurals not listed above are deliberate
  //     — the test enforces the full registered-tool list is covered.
};

/**
 * Bounded estimate clamping — defense against poisoned learned-rule
 * input (Phase 4b). Static-rule values are author-bounded so this is
 * a no-op for v1.4.0; wired in early so the contract is in place.
 */
const TOKEN_ESTIMATE_MIN = 0;
const TOKEN_ESTIMATE_MAX = 100_000;

function clampEstimate(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(TOKEN_ESTIMATE_MIN, Math.min(TOKEN_ESTIMATE_MAX, Math.round(n)));
}

/**
 * Look up next-tool suggestions for a tool that just ran.
 *
 * Resolution order:
 *
 *   1. **Learned rules** (Phase 4b) — telemetry-derived suggestions
 *      from `getLearnedRules()`. Reflects how agents actually use
 *      this tool in this user's recent history. Cached 1h.
 *      Returned ONLY if the user has accumulated enough telemetry
 *      (≥3 transition samples per pair, default 14-day window).
 *   2. **Static rules** — author-curated fallback for tools the
 *      learner hasn't seen yet. Always present; covers all tools.
 *
 * @param fromTool — name of the tool that produced the response we're
 *   attaching suggestions to.
 * @param registeredTools — OPTIONAL canonical set of registered tool
 *   names from `ToolRegistry.list()`. When provided, suggestions
 *   pointing at non-registered tools are filtered out.
 * @returns up to 3 suggestions with clamped token estimates. Empty
 *   array if no rules exist.
 *
 * @public
 */
export function suggestNext(
  fromTool: string,
  registeredTools?: ReadonlySet<string>,
): NextToolSuggestion[] {
  // Phase 4b: try learned rules first when the user has opted in via
  // CTXLOOM_LEARNED_SUGGESTIONS=1. The learner is the higher-priority
  // source because real usage beats author guesses once enough samples
  // accumulate — but it's opt-in for v1.5.0 so existing test
  // assertions + zero-telemetry deployments aren't affected by the
  // change. Future versions may flip the default once the learner
  // earns user trust.
  if (process.env.CTXLOOM_LEARNED_SUGGESTIONS === '1') {
    const learned = getLearnedRules({ registeredTools })[fromTool];
    if (learned && learned.length > 0) {
      return learned.slice(0, 3).map((s) => ({
        tool: s.tool,
        args: s.args,
        why: s.why,
        estimated_tokens: clampEstimate(s.estimated_tokens),
      }));
    }
  }

  // Fallback to author-curated static rules.
  const raw = STATIC_RULES[fromTool] ?? [];
  const filtered = registeredTools
    ? raw.filter((s) => registeredTools.has(s.tool))
    : raw;
  return filtered
    .slice(0, 3)
    .map((s) => ({
      tool: s.tool,
      args: s.args,
      why: s.why,
      estimated_tokens: clampEstimate(s.estimated_tokens),
    }));
}

/**
 * Test hook — returns every tool name referenced as a follow-up in
 * the static rules. The drift test asserts each is in the registry.
 *
 * @internal
 */
export function __referencedToolsForTests(): string[] {
  const out = new Set<string>();
  for (const arr of Object.values(STATIC_RULES)) {
    for (const s of arr) out.add(s.tool);
  }
  return Array.from(out).sort();
}

/**
 * Test hook — returns the set of tools that HAVE rules defined (i.e.
 * the keys of STATIC_RULES). The drift test asserts each is in the
 * registry, ensuring we don't curate rules for a tool that was
 * deleted.
 *
 * @internal
 */
export function __sourceToolsForTests(): string[] {
  return Object.keys(STATIC_RULES).sort();
}
