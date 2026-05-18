/**
 * taskBudget.ts — server-enforced graph-call budget. Phase 4a of the
 * agent-harness plan (docs/superpowers/plans/2026-05-18-agent-harness.md).
 *
 * Problem: the CLAUDE.md rules block prescribes "≤8 tool calls per
 * task, ≤2000 tokens of graph context" — code-review-graph's protocol
 * target. That's *prose*. An agent that ignores it pays no price
 * beyond eventually finishing slower / more expensive. v1.5 promotes
 * this from documentation to enforcement: when an agent exceeds the
 * call budget, subsequent tool responses auto-default to
 * skeleton/minimal mode regardless of caller-supplied args.
 *
 * Improvements over code-review-graph (which has no equivalent):
 *
 *   - **Per-task auto-reset.** Inactivity gap (default 90s) ends one
 *     "task" and starts another. Long Claude Code sessions doing
 *     several unrelated workflows each get a fresh budget.
 *   - **Single emit per breach.** The over-budget telemetry event
 *     fires once per task, not per call — log-flood safe.
 *   - **Kill-switch friendly.** Respects CTXLOOM_DISABLE_BUDGET=1
 *     (the same env that gates the response-side budget surface).
 *
 * Threat model / privacy:
 *
 *   - Counter state is process-local — no IPC, no disk persistence.
 *   - No user input persists in the tracker (no task text, no args).
 *   - Worst case if the tracker bug-fails: agents see un-throttled
 *     responses (the existing per-response budget surface is the
 *     fallback safety).
 *
 * Performance:
 *
 *   - O(1) per tool call (Map lookup + counter increment + timestamp
 *     compare). ~50ns hot path.
 *   - No allocations on the hot path beyond the Map entry which is
 *     reused. Cleanup happens lazily on the next call from any
 *     session whose entry has expired (no GC thread).
 */

import { isBudgetDisabled } from './budget.js';
import { emitTelemetry } from './budget.js';

/**
 * Default ceiling — mirrors the "≤8 tool calls per task" protocol
 * target from the CLAUDE.md rules block.
 */
const DEFAULT_MAX_CALLS = 8;

/**
 * Inactivity gap that ends one "task" and starts a new budget. 90s
 * picked so a coding session that gets distracted (slack, code review
 * comment, etc.) doesn't accidentally bleed into the next task's
 * budget. Tunable via constructor.
 */
const DEFAULT_RESET_GAP_MS = 90_000;

/**
 * Environment variable override for the call ceiling. Strings parse
 * as integers; non-numeric or zero values fall back to the default.
 */
const ENV_VAR = 'CTXLOOM_TASK_TOOL_BUDGET';

function parseEnvBudget(): number | null {
  const raw = process.env[ENV_VAR];
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Decision returned from `recordCall()` — caller can inspect to
 * surface the breach (telemetry, response-meta flag, etc).
 */
export interface TaskBudgetDecision {
  /** True when the call that just landed pushed the counter over the limit. */
  overBudget: boolean;
  /** Total calls this task (after the current one). */
  callCount: number;
  /** Configured ceiling. */
  maxCalls: number;
  /**
   * True when THIS call is the first one over budget. Lets callers
   * emit the breach telemetry event exactly once per task —
   * subsequent over-budget calls return `overBudget: true` AND
   * `firstBreach: false` so log-flooding is avoided.
   */
  firstBreach: boolean;
}

interface SessionState {
  count: number;
  lastCallTs: number;
  /** True after the first breach event was emitted. */
  breachEmitted: boolean;
}

/**
 * Per-session tool-call counter with inactivity-gap auto-reset.
 *
 * Currently a singleton per process — there's no MCP session ID
 * threaded through dispatch yet. Future work (Phase 4b telemetry
 * + multi-tenant deployments) may want to thread a session ID
 * through; the class is shape-stable for that.
 *
 * @public
 */
export class TaskBudgetTracker {
  private state = new Map<string, SessionState>();
  private readonly maxCalls: number;
  private readonly resetGapMs: number;

  constructor(opts: { maxCalls?: number; resetGapMs?: number } = {}) {
    this.maxCalls = opts.maxCalls ?? parseEnvBudget() ?? DEFAULT_MAX_CALLS;
    this.resetGapMs = opts.resetGapMs ?? DEFAULT_RESET_GAP_MS;
  }

  /**
   * Record a tool call against the budget. Returns the enforcement
   * decision the dispatch layer should act on.
   *
   * @param sessionId — opaque session identifier. Currently a
   *   single global key ('process'); reserved for future multi-
   *   session enforcement.
   * @param now — milliseconds since epoch. Test hook; defaults to
   *   `Date.now()`.
   */
  recordCall(sessionId: string = 'process', now: number = Date.now()): TaskBudgetDecision {
    // Honor the global kill switch — when disabled, every call is
    // "under budget" and no state mutates. Matches the kill-switch
    // behavior of the response-side budget surface.
    if (isBudgetDisabled()) {
      return {
        overBudget: false,
        callCount: 0,
        maxCalls: this.maxCalls,
        firstBreach: false,
      };
    }

    const existing = this.state.get(sessionId);

    // Inactivity gap → new task starts. Reset counter + clear the
    // breachEmitted flag so the next breach fires its telemetry.
    if (existing && now - existing.lastCallTs > this.resetGapMs) {
      const fresh: SessionState = { count: 1, lastCallTs: now, breachEmitted: false };
      this.state.set(sessionId, fresh);
      return {
        overBudget: false,
        callCount: 1,
        maxCalls: this.maxCalls,
        firstBreach: false,
      };
    }

    // Continuation of the current task.
    const next = (existing?.count ?? 0) + 1;
    const wasBreached = existing?.breachEmitted ?? false;
    const overBudget = next > this.maxCalls;
    const firstBreach = overBudget && !wasBreached;

    this.state.set(sessionId, {
      count: next,
      lastCallTs: now,
      breachEmitted: wasBreached || firstBreach,
    });

    return { overBudget, callCount: next, maxCalls: this.maxCalls, firstBreach };
  }

  /**
   * Test-only: drop all state. Lets tests run in isolation without
   * depending on order.
   *
   * @internal
   */
  reset(): void {
    this.state.clear();
  }

  /**
   * Test/diagnostic — current call count for the default session.
   * @internal
   */
  __getCount(sessionId: string = 'process'): number {
    return this.state.get(sessionId)?.count ?? 0;
  }
}

/**
 * Process-singleton instance. Most callers want this one — the class
 * exists for future multi-tenant scenarios + isolated testing.
 *
 * Lazy-instantiated so an env-var change between module load and
 * first call (test scenarios) takes effect.
 *
 * @public
 */
let _singleton: TaskBudgetTracker | null = null;
export function getTaskBudgetTracker(): TaskBudgetTracker {
  if (!_singleton) _singleton = new TaskBudgetTracker();
  return _singleton;
}

/**
 * Test-only: rebuild the singleton. Picks up env-var changes.
 * @internal
 */
export function __resetTaskBudgetTrackerForTests(): void {
  _singleton = null;
}

/**
 * Argument injection for over-budget tool calls.
 *
 * When the dispatch layer sees `overBudget: true`, it modifies the
 * caller's args BEFORE handing them to the tool — forcing skeleton/
 * minimal mode regardless of what the caller asked for. Tools that
 * don't recognize the injected fields ignore them (Zod schemas
 * strip unknown keys by default).
 *
 * The values intentionally mirror the smallest sensible response —
 * `max_response_tokens: 200` is enough for the typical structural
 * envelope without bodies.
 *
 * @public
 */
export const OVER_BUDGET_ARG_OVERRIDES: Readonly<Record<string, unknown>> = Object.freeze({
  // Budget-surface tools (the 12 source-returning ones).
  max_response_tokens: 200,
  response_format: 'skeleton',
  on_budget_exceeded: 'skeleton',
  // Tools with detail_level (hub_nodes, bridge_nodes, etc).
  detail_level: 'minimal',
});

/**
 * Merge OVER_BUDGET_ARG_OVERRIDES into the caller's args, preserving
 * any keys the caller didn't supply but overriding ones they did.
 *
 * Why override (not merge-preferring-caller): the whole point of
 * enforcement is to make the caller's hint ineffective when over
 * budget. An agent that says "give me the full response, ignore the
 * budget" is exactly the case we're protecting against.
 *
 * @public
 */
export function applyOverBudgetOverrides(args: unknown): unknown {
  if (!args || typeof args !== 'object') {
    return { ...OVER_BUDGET_ARG_OVERRIDES };
  }
  return { ...(args as Record<string, unknown>), ...OVER_BUDGET_ARG_OVERRIDES };
}

/**
 * Emit the once-per-task `mcp.task_budget.exceeded` telemetry event.
 * Idempotent within a task (the firstBreach flag from
 * `recordCall()` controls when to call this).
 *
 * @public
 */
export function emitTaskBudgetBreached(toolName: string, callCount: number, maxCalls: number): void {
  emitTelemetry({
    event: 'mcp.task_budget.exceeded',
    tool: toolName,
    calls: callCount,
    budget: maxCalls,
  });
}
