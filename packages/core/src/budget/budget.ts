/**
 * Server-side max_response_tokens budget + skeleton-fallback helper.
 *
 * Phase B2 (#106) infrastructure module — provides the shared primitives
 * that the 12 source-returning tools will integrate against:
 *
 *   - Token estimator (chars/4 default, pluggable for tiktoken)
 *   - BudgetArgs parser (the 3 new optional input fields)
 *   - enforceBudget() — applies the fallback ladder
 *   - wrapResponse() — packages the result into the {data, meta} envelope
 *   - CTXLOOM_DISABLE_BUDGET kill switch
 *   - CTXLOOM_TELEMETRY_LEVEL=full event emission
 *
 * No tool changes in this commit — the 12-tool rollout lands in
 * subsequent B2.2…B2.5 PRs so each batch can be reviewed in isolation
 * and the existing ToolHandler signature (returns Promise<string>)
 * stays stable for the 21 untouched tools.
 *
 * Back-compat invariant: when a tool's caller passes NONE of the 3
 * new input fields, the wrapper returns the raw text unchanged. The
 * meta envelope only appears when a caller opts in.
 */
import { logger } from '../utils/logger.js';
import { diskSink, type TelemetrySink } from './eventCollector.js';
import { suggestNext, type NextToolSuggestion } from './nextToolSuggestions.js';

// Re-export so existing consumers that import TelemetrySink from
// the budget module's barrel-equivalent (budget.ts) keep working.
// The actual type definition lives next to its default
// implementation in eventCollector.ts.
export type { TelemetrySink };
// Re-export the next-tool suggestion type so consumers that already
// import from `./budget.js` (the public budget barrel) pick it up
// without learning a second import path.
export type { NextToolSuggestion };
export { diskSink };

// ─── Token estimator ──────────────────────────────────────────────────

/**
 * A pluggable token estimator. The default approximates ~chars/4, which
 * is within ±10% of GPT/Claude tokenizers on code without adding any
 * tokenization cost. Callers that need accuracy can install a
 * tiktoken-backed estimator via ServerContext at boot time.
 */
export type TokenEstimator = (text: string) => number;

export const defaultTokenEstimator: TokenEstimator = (text) =>
  Math.ceil(text.length / 4);

// ─── BudgetArgs — the 3 new input fields ─────────────────────────────

export type OnBudgetExceeded = 'skeleton' | 'truncate' | 'error';
export type ResponseFormat = 'full' | 'skeleton' | 'auto';
export type ResponseFormatRendered = 'full' | 'skeleton' | 'truncated';

export type FallbackReason =
  | null
  | 'budget_exceeded'
  | 'minified_input'
  | 'size_cap'
  | 'skeleton_failed';

export interface BudgetArgs {
  max_response_tokens?: number;
  on_budget_exceeded?: OnBudgetExceeded;
  response_format?: ResponseFormat;
}

/**
 * Whether a caller opted into the budget surface at all. When false,
 * tools MUST return the raw response unchanged (back-compat invariant).
 *
 * @public Exported for tests + per-tool integration helpers.
 */
export function hasBudgetArgs(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const a = args as Record<string, unknown>;
  return (
    a.max_response_tokens !== undefined ||
    a.on_budget_exceeded !== undefined ||
    a.response_format !== undefined
  );
}

/**
 * Pull the three budget fields out of an arbitrary args record.
 * Tools' Zod schemas validate the values; this helper just narrows
 * the type so the budget helpers don't need to know about each
 * tool's full schema.
 */
export function readBudgetArgs(args: unknown): BudgetArgs {
  if (!args || typeof args !== 'object') return {};
  const a = args as Record<string, unknown>;
  const out: BudgetArgs = {};
  if (typeof a.max_response_tokens === 'number') out.max_response_tokens = a.max_response_tokens;
  if (a.on_budget_exceeded === 'skeleton' || a.on_budget_exceeded === 'truncate' || a.on_budget_exceeded === 'error') {
    out.on_budget_exceeded = a.on_budget_exceeded;
  }
  if (a.response_format === 'full' || a.response_format === 'skeleton' || a.response_format === 'auto') {
    out.response_format = a.response_format;
  }
  return out;
}

// ─── Response envelope ───────────────────────────────────────────────

export interface BudgetMeta {
  format: ResponseFormatRendered;
  original_tokens_est: number;
  returned_tokens_est: number;
  fallback_reason: FallbackReason;
  /**
   * Author-curated follow-up MCP calls — agents can pick the next
   * step without guessing. Each entry carries `why` reasoning + a
   * token-cost estimate so the agent can budget the next call.
   *
   * Wiring: populated by `enforceBudget()` via `suggestNext()` from
   * `nextToolSuggestions.ts`. Filtered through the registered-tools
   * allowlist (defense against telemetry-poisoned rules in the
   * Phase 4b learner).
   *
   * Closes Phase 1b of the agent-harness plan.
   *
   * @public
   */
  next_tool_suggestions?: NextToolSuggestion[];
}

export interface BudgetEnvelope {
  data: string;
  meta: BudgetMeta;
}

// ─── Feature flag ────────────────────────────────────────────────────

/**
 * Kill switch: when CTXLOOM_DISABLE_BUDGET=1, all budget args are
 * silently ignored and tools behave as if no budget surface exists.
 * Documented escape hatch for the soak period after the B2 rollout.
 */
export function isBudgetDisabled(): boolean {
  return process.env.CTXLOOM_DISABLE_BUDGET === '1';
}

// ─── Telemetry ───────────────────────────────────────────────────────

interface TelemetryEvent {
  event: string;
  tool: string;
  [key: string]: unknown;
}

/**
 * Emit a structured telemetry event when CTXLOOM_TELEMETRY_LEVEL=full.
 * Uses the standard logger so events surface in JSON mode (MCP) and
 * are suppressed in CLI mode — same plumbing as every other event.
 *
 * The sink controls where the EVENT is persisted (default: disk
 * JSONL via `diskSink`). Tests typically pass an in-memory sink so
 * they can assert event shape without touching the disk or
 * scoping CTXLOOM_TELEMETRY_DIR. The stderr `logger.info()` call
 * fires independently — it's the live-observability channel and
 * is not controlled by the sink (callers that want to mute it
 * use LOG_LEVEL or CTXLOOM_LOG_MODE).
 *
 * Exported so tests can pin event shape without spying on logger.
 */
export function emitTelemetry(event: TelemetryEvent, sink: TelemetrySink = diskSink): void {
  if (process.env.CTXLOOM_TELEMETRY_LEVEL !== 'full') return;
  // Live observability: stderr JSON line via the shared logger so
  // the event also flows through whatever the user has attached.
  logger.info(event.event, event);
  // Persistent observability: route through the sink. Default sink
  // writes to ~/.ctxloom/telemetry/ via `appendEvent` (which already
  // swallows fs errors). The try/catch here defends against
  // third-party sinks (Sentry / OTLP / dashboard ring buffer) that
  // forget to honor the `TelemetrySink.append` JSDoc contract —
  // telemetry MUST NEVER fault the request that fired the event.
  // The PR #139 dogfood (M1) caught this gap: pre-fix, only diskSink
  // was crash-safe; the type itself did not enforce the invariant.
  try {
    sink.append(event);
  } catch {
    // Intentionally swallowed — sink errors are observability
    // regressions, never correctness failures. The stderr-side
    // `logger.info()` above already surfaced the event for live
    // observability; losing the persisted sink call is a stats-
    // visibility regression, not a tool-call failure.
  }
}

// ─── enforceBudget — the fallback ladder ─────────────────────────────

export interface EnforceBudgetOptions {
  /** The full text the tool would return without a budget. */
  full: string;
  /** Caller's resolved budget args (already parsed). */
  args: BudgetArgs;
  /** Tool name for telemetry tagging. */
  toolName: string;
  /**
   * Per-tool default max_response_tokens. Activates ONLY when the
   * caller has opted into the budget surface (hasBudgetArgs === true)
   * but did not specify max_response_tokens explicitly. Unset = no
   * default.
   */
  defaultMaxTokens?: number;
  /**
   * Skeleton-fallback producer. Called when the response is over
   * budget and on_budget_exceeded === 'skeleton'. Returns the
   * skeleton text, or null if no skeleton is available for this
   * input (e.g. tool doesn't have file context). When null, the
   * helper falls through to plain truncation with
   * fallback_reason: 'skeleton_failed'.
   */
  skeletonProducer?: () => Promise<string | null>;
  /** Override the default chars/4 estimator. */
  estimator?: TokenEstimator;
  /**
   * Override the default disk-JSONL telemetry sink. Tests use an
   * in-memory sink to assert event emission without touching
   * ~/.ctxloom/telemetry/. Web dashboard / Sentry / OTLP exporters
   * are the other natural use case. Defaults to `diskSink`.
   *
   * Resolution precedence (highest first):
   *   1. opts.sink — per-call override (tests, special cases)
   *   2. opts.ctx?.telemetrySink — process-level boot wiring
   *   3. diskSink — default disk-JSONL persistence
   */
  sink?: TelemetrySink;
  /**
   * Structural slice of `ServerContext` — declared structurally
   * (not as `ServerContext` proper) to avoid a circular import
   * between `packages/core/src/budget/` and `packages/core/src/tools/`.
   * Tool registrars pass the full `ServerContext` here; budget code
   * only reads `.telemetrySink`.
   *
   * Closes #141 from the Phase B A/B dogfood gate: lets the boot site
   * pick the telemetry transport ONCE for all 12+ instrumented tools.
   */
  ctx?: { telemetrySink?: TelemetrySink };
}

export interface BudgetedResult {
  text: string;
  meta: BudgetMeta;
}

/**
 * Apply the budget surface to a rendered response.
 *
 * Decision tree (in order of precedence):
 *   1. Kill switch (CTXLOOM_DISABLE_BUDGET=1) → return full, no envelope work
 *   2. response_format: 'skeleton' (explicit) → run skeleton, return that
 *   3. No budget resolved (no max_response_tokens, no default) → return full
 *   4. Under budget → return full
 *   5. Over budget:
 *      - on_budget_exceeded === 'error' → throw structured Error
 *      - on_budget_exceeded === 'truncate' → slice text to budget
 *      - else (default 'skeleton'):
 *         a. skeletonProducer produces a skeleton + it's under budget → use it
 *         b. skeleton still over budget → slice the skeleton to budget
 *         c. no skeletonProducer or skeletonProducer returned null → slice full
 *
 * Emits mcp.budget.exceeded + mcp.fallback.used events when telemetry
 * is enabled and the budget actually triggered a fallback.
 *
 * @public
 */
export async function enforceBudget(opts: EnforceBudgetOptions): Promise<BudgetedResult> {
  const { full, args, toolName, defaultMaxTokens, skeletonProducer } = opts;
  const estimate = opts.estimator ?? defaultTokenEstimator;
  // Default to the disk-JSONL sink. Tests inject a mem sink to
  // assert event emission without disk I/O; alternate transports
  // (dashboard / Sentry / OTLP) can plug in here too.
  // Sink resolution precedence (highest first):
  //   1. opts.sink            — per-call override (tests, special cases)
  //   2. opts.ctx.telemetrySink — process-level boot wiring (issue #141)
  //   3. diskSink              — default disk-JSONL persistence
  const sink: TelemetrySink = opts.sink ?? opts.ctx?.telemetrySink ?? diskSink;

  // Phase 1b — next-tool suggestions. Computed ONCE here so the same
  // array is shared across every meta object produced by this call
  // (no per-branch recomputation). Static lookup; ~0 cost.
  // Allowlist param intentionally omitted — drift test enforces
  // static-rule targets are registered. Phase 4b (learned rules) will
  // pass the registered-tools set when the learner is enabled.
  const nextToolSuggestions = suggestNext(toolName);
  /**
   * Helper — attaches `next_tool_suggestions` to a base meta literal.
   * Centralizes the field naming so a future field-shape change
   * (rename, version bump) is a one-line edit. Returns undefined
   * field when the suggestion array is empty so consumers don't see
   * a noisy empty array in responses.
   */
  const withSuggestions = <T extends BudgetMeta>(base: T): T => {
    if (nextToolSuggestions.length === 0) return base;
    return { ...base, next_tool_suggestions: nextToolSuggestions };
  };

  // Pre-compute the full-response token count once — used by every
  // downstream branch for the meta envelope.
  const originalTokens = estimate(full);

  // (1) Kill switch — short-circuit before doing any budget work.
  if (isBudgetDisabled()) {
    return {
      text: full,
      meta: withSuggestions({
        format: 'full',
        original_tokens_est: originalTokens,
        returned_tokens_est: originalTokens,
        fallback_reason: null,
      }),
    };
  }

  // (2) Explicit response_format: 'skeleton' — caller wants skeleton
  // regardless of budget. response_format: 'auto' behaves like 'full'
  // until a budget kicks in (auto = let the budget decide).
  if (args.response_format === 'skeleton' && skeletonProducer) {
    const skeleton = await safeSkeleton(skeletonProducer, toolName);
    if (skeleton !== null) {
      const skTokens = estimate(skeleton);
      return {
        text: skeleton,
        meta: withSuggestions({
          format: 'skeleton',
          original_tokens_est: originalTokens,
          returned_tokens_est: skTokens,
          fallback_reason: null,
        }),
      };
    }
    // Fall through: skeleton producer failed, return full + flag it.
    return {
      text: full,
      meta: withSuggestions({
        format: 'full',
        original_tokens_est: originalTokens,
        returned_tokens_est: originalTokens,
        fallback_reason: 'skeleton_failed',
      }),
    };
  }

  // (3) Resolve the effective budget.
  const budget = args.max_response_tokens ?? defaultMaxTokens;
  if (budget === undefined) {
    return {
      text: full,
      meta: withSuggestions({
        format: 'full',
        original_tokens_est: originalTokens,
        returned_tokens_est: originalTokens,
        fallback_reason: null,
      }),
    };
  }

  // (4) Under budget — return full as-is.
  if (originalTokens <= budget) {
    return {
      text: full,
      meta: withSuggestions({
        format: 'full',
        original_tokens_est: originalTokens,
        returned_tokens_est: originalTokens,
        fallback_reason: null,
      }),
    };
  }

  // (5) Over budget. Emit the breach event before deciding the fallback.
  emitTelemetry({
    event: 'mcp.budget.exceeded',
    tool: toolName,
    original_tokens: originalTokens,
    budget,
    ratio: originalTokens / budget,
  }, sink);

  const mode = args.on_budget_exceeded ?? 'skeleton';

  if (mode === 'error') {
    const err = new Error(
      `Response of ~${originalTokens} tokens exceeds max_response_tokens=${budget} for tool '${toolName}'. Re-ask with response_format: 'skeleton' or a larger budget.`,
    );
    // Tag the error with structured context so callers can surface it.
    (err as Error & { tokensOriginal?: number; budget?: number; tool?: string }).tokensOriginal = originalTokens;
    (err as Error & { tokensOriginal?: number; budget?: number; tool?: string }).budget = budget;
    (err as Error & { tokensOriginal?: number; budget?: number; tool?: string }).tool = toolName;
    throw err;
  }

  if (mode === 'truncate') {
    // Best-effort character truncation. budget * 4 chars approximates
    // the same chars/4 estimator the budget itself uses, so the
    // returned slice should fit (within ±1 token).
    const sliced = full.slice(0, budget * 4);
    const slicedTokens = estimate(sliced);
    emitTelemetry({
      event: 'mcp.fallback.used',
      tool: toolName,
      fallback_reason: 'budget_exceeded',
      mode: 'truncate',
    }, sink);
    return {
      text: sliced,
      meta: withSuggestions({
        format: 'truncated',
        original_tokens_est: originalTokens,
        returned_tokens_est: slicedTokens,
        fallback_reason: 'budget_exceeded',
      }),
    };
  }

  // Default: 'skeleton'.
  const skeleton = skeletonProducer ? await safeSkeleton(skeletonProducer, toolName) : null;

  if (skeleton !== null) {
    const skTokens = estimate(skeleton);
    if (skTokens <= budget) {
      emitTelemetry({
        event: 'mcp.fallback.used',
        tool: toolName,
        fallback_reason: 'budget_exceeded',
        mode: 'skeleton',
      }, sink);
      return {
        text: skeleton,
        meta: withSuggestions({
          format: 'skeleton',
          original_tokens_est: originalTokens,
          returned_tokens_est: skTokens,
          fallback_reason: 'budget_exceeded',
        }),
      };
    }
    // Skeleton still over budget — slice it.
    const slicedSk = skeleton.slice(0, budget * 4);
    emitTelemetry({
      event: 'mcp.fallback.used',
      tool: toolName,
      fallback_reason: 'budget_exceeded',
      mode: 'skeleton+truncate',
    }, sink);
    return {
      text: slicedSk,
      meta: withSuggestions({
        format: 'truncated',
        original_tokens_est: originalTokens,
        returned_tokens_est: estimate(slicedSk),
        fallback_reason: 'budget_exceeded',
      }),
    };
  }

  // No skeleton path — fall back to truncation with skeleton_failed flag.
  const sliced = full.slice(0, budget * 4);
  emitTelemetry({
    event: 'mcp.fallback.used',
    tool: toolName,
    fallback_reason: 'skeleton_failed',
    mode: 'truncate-fallback',
  }, sink);
  return {
    text: sliced,
    meta: withSuggestions({
      format: 'truncated',
      original_tokens_est: originalTokens,
      returned_tokens_est: estimate(sliced),
      fallback_reason: 'skeleton_failed',
    }),
  };
}

/**
 * Run the skeleton producer with crash isolation. Per the issue's
 * risk matrix:
 *   "Skeletonizer crashes on a new language → tool returns error
 *    Mitigation: Wrap in try/catch, fall back to raw truncation
 *    with fallback_reason: 'skeleton_failed'"
 */
async function safeSkeleton(
  producer: () => Promise<string | null>,
  toolName: string,
): Promise<string | null> {
  try {
    return await producer();
  } catch (err) {
    logger.warn('Skeleton fallback failed', {
      tool: toolName,
      detail: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── wrapResponse — final envelope packaging ─────────────────────────

/**
 * Final step in a tool handler that opted into the budget surface.
 * Serializes the BudgetedResult into the JSON envelope the spec
 * defines:
 *
 *   { "data": "<text>", "meta": { format, original_tokens_est, ... } }
 *
 * Tools that DID NOT have any of the 3 new args from the caller
 * (`hasBudgetArgs(args) === false`) MUST NOT call this — they
 * preserve back-compat by returning the raw text directly.
 */
export function wrapResponse(result: BudgetedResult): string {
  const envelope: BudgetEnvelope = {
    data: result.text,
    meta: result.meta,
  };
  return JSON.stringify(envelope);
}
