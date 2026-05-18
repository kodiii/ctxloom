/**
 * learnedSuggestions.ts — Phase 4b of the agent-harness plan.
 *
 * Mines `~/.ctxloom/telemetry/budget-events-*.jsonl` to derive
 * `next_tool_suggestions` from real usage data. Replaces the static
 * author-curated rules in `nextToolSuggestions.ts` once enough
 * telemetry has accumulated (defaults: 14-day window, ≥5 transition
 * samples per pair to count).
 *
 * Why learned beats static:
 *
 *   - The static rules are an author's guess at typical workflows.
 *     The learner reflects how agents ACTUALLY use the tools.
 *   - Tool sequences vary by repo size, language, team workflow.
 *     A user's own session history is a better predictor of "what
 *     comes next?" than any global prior.
 *   - As ctxloom adds tools, the learner picks up new transitions
 *     without an author needing to update STATIC_RULES.
 *
 * Privacy: events on disk carry only event name + tool name + token
 * counts + mode/reason enums (the contract pinned by PR #140's L3
 * test). No source content, no paths, no queries. The learner reads
 * ONLY the event + tool fields, so even a poisoned telemetry file
 * couldn't inject arbitrary `why` text or `args` into suggestions.
 *
 * Safety:
 *
 *   - Result subjected to the registered-tools allowlist before
 *     anything ships to the agent. A telemetry file that mentions
 *     `ctx_unknown_tool` simply gets filtered out.
 *   - Token estimates clamped to [0, 100_000] (matches the static-
 *     rule clamp in nextToolSuggestions.ts).
 *   - On parse failure → empty result, fall through to static rules.
 *   - 1-hour cache prevents re-mining on every tool call.
 *
 * Performance:
 *
 *   - One-shot at startup: ~50ms for 14 days of events (~5000 lines
 *     on a heavy CI account).
 *   - Zero per-call cost — `suggestNext()` reads from the cached
 *     map, same as the static rules.
 */
import { readEvents, type PersistedEvent } from './eventCollector.js';
import type { NextToolSuggestion } from './nextToolSuggestions.js';

// ─── Learner config ──────────────────────────────────────────────────

const DEFAULT_WINDOW_DAYS = 14;
const SESSION_GAP_MS = 90_000;
const MIN_SAMPLES_PER_PAIR = 3;
const TOP_K = 3;

/** Cache TTL — re-mine telemetry at most once per hour. */
const CACHE_TTL_MS = 60 * 60 * 1000;

// ─── Output shape ────────────────────────────────────────────────────

/**
 * Per-source-tool learned suggestions. Same shape as the static
 * rules so callers can merge / replace without conversion.
 *
 * @public
 */
export type LearnedRules = Record<string, NextToolSuggestion[]>;

interface CacheEntry {
  rules: LearnedRules;
  expiresAt: number;
}

let _cache: CacheEntry | null = null;

/**
 * Test-only: drop the cache.
 *
 * @internal
 */
export function __resetLearnedSuggestionsCacheForTests(): void {
  _cache = null;
}

// ─── Token estimate clamp (defense vs poisoned telemetry) ────────────

function clampTokens(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100_000, Math.round(n)));
}

// ─── Core learning algorithm ─────────────────────────────────────────

export interface LearnSuggestionsOptions {
  /** Days of history to mine. Default 14. */
  windowDays?: number;
  /**
   * Maximum gap between two consecutive events that still counts as
   * "same task". Default 90s (matches TaskBudgetTracker's default).
   */
  sessionGapMs?: number;
  /**
   * Minimum transition samples before a (from, to) pair surfaces in
   * the suggestions. Filters out noise from rarely-co-occurring
   * tools. Default 3.
   */
  minSamples?: number;
  /**
   * Allowlist of registered tool names. When provided, transitions
   * whose `from` or `to` aren't in the allowlist are dropped. Defense
   * against telemetry mentioning deleted / renamed tools.
   */
  registeredTools?: ReadonlySet<string>;
  /**
   * Pre-loaded events (test hook). When omitted, the function reads
   * from disk via `readEvents()`.
   */
  events?: PersistedEvent[];
}

/**
 * Mine telemetry events for tool-transition frequencies.
 *
 * Algorithm:
 *
 *   1. Sort events by timestamp ascending
 *   2. Walk the sequence; group consecutive events into "sessions"
 *      bounded by `sessionGapMs` inactivity
 *   3. Within each session, count every (from→to) pair where `from`
 *      is the previous event's tool and `to` is the current event's
 *      tool (skip same-tool repeats — they're not useful follow-ups)
 *   4. Sum across all sessions
 *   5. For each `from` tool, sort `to` candidates by count descending
 *      and take the top `TOP_K`
 *   6. Drop candidates with fewer than `minSamples` observations
 *   7. Filter through `registeredTools` allowlist if provided
 *
 * @public
 */
export function learnSuggestionsFromTelemetry(
  opts: LearnSuggestionsOptions = {},
): LearnedRules {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const sessionGapMs = opts.sessionGapMs ?? SESSION_GAP_MS;
  const minSamples = opts.minSamples ?? MIN_SAMPLES_PER_PAIR;
  const allowlist = opts.registeredTools;

  // Read events from disk (or use the test hook).
  const events: PersistedEvent[] =
    opts.events ?? safeReadEvents(windowDays);
  if (events.length === 0) return {};

  // Sort by ts ascending so the transition walk works.
  const sorted = events
    .map((e) => ({ ts: Date.parse(e.ts), tool: e.tool }))
    .filter((e) => Number.isFinite(e.ts) && typeof e.tool === 'string' && e.tool.length > 0)
    .sort((a, b) => a.ts - b.ts);

  // Count (from → to) transitions. Use a nested Map for cheap O(1)
  // increments.
  const transitions = new Map<string, Map<string, number>>();
  // Approximate token-cost estimate per destination tool — average
  // of the destination event's `original_tokens` field, if present.
  // Useful because the learner can fill `estimated_tokens` from
  // observed reality instead of author guesses.
  const tokenSums = new Map<string, { sum: number; n: number }>();

  let prevTool: string | null = null;
  let prevTs = -Infinity;

  for (const e of sorted) {
    if (prevTool && e.tool !== prevTool && e.ts - prevTs <= sessionGapMs) {
      // Valid same-session transition.
      let row = transitions.get(prevTool);
      if (!row) {
        row = new Map();
        transitions.set(prevTool, row);
      }
      row.set(e.tool, (row.get(e.tool) ?? 0) + 1);
    }
    prevTool = e.tool;
    prevTs = e.ts;
  }

  // Collect token observations per tool (separate pass over the same
  // events). The learner uses these to fill `estimated_tokens` on
  // suggestions.
  for (const raw of events) {
    const tok = (raw as { original_tokens?: unknown }).original_tokens;
    if (typeof tok === 'number' && Number.isFinite(tok)) {
      const acc = tokenSums.get(raw.tool) ?? { sum: 0, n: 0 };
      acc.sum += tok;
      acc.n += 1;
      tokenSums.set(raw.tool, acc);
    }
  }

  // Build the LearnedRules output.
  const out: LearnedRules = {};
  for (const [from, row] of transitions) {
    if (allowlist && !allowlist.has(from)) continue;
    const candidates: NextToolSuggestion[] = [];
    for (const [to, count] of row) {
      if (count < minSamples) continue;
      if (allowlist && !allowlist.has(to)) continue;
      const tokenAcc = tokenSums.get(to);
      const avgTokens = tokenAcc && tokenAcc.n > 0 ? tokenAcc.sum / tokenAcc.n : 0;
      candidates.push({
        tool: to,
        why: `Learned from telemetry: ${count} agents followed ${from} with ${to}.`,
        estimated_tokens: clampTokens(avgTokens),
      });
    }
    if (candidates.length === 0) continue;
    // Sort by count (count is encoded in the order we built — but
    // we lose the raw count after building candidates. Easier: keep
    // the count in a tuple during sort).
    candidates.sort((a, b) => {
      // Extract observed count from the why string — not the
      // cleanest, but works for this implementation. Future: keep
      // count as a separate field.
      const matchA = a.why.match(/(\d+) agents/);
      const matchB = b.why.match(/(\d+) agents/);
      const ca = matchA ? parseInt(matchA[1], 10) : 0;
      const cb = matchB ? parseInt(matchB[1], 10) : 0;
      return cb - ca;
    });
    out[from] = candidates.slice(0, TOP_K);
  }

  return out;
}

/**
 * Read telemetry events from disk inside a try/catch — telemetry
 * read failures must never bubble up into suggestion-serving. The
 * fallback is "no learned rules", which causes `suggestNext()` to
 * fall through to the static curated rules.
 */
function safeReadEvents(windowDays: number): PersistedEvent[] {
  try {
    const until = new Date();
    const since = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
    return readEvents({ since, until });
  } catch {
    return [];
  }
}

/**
 * 1-hour-cached learner result. The first call per process spends
 * the mining time; subsequent calls return the cached map. Cache
 * key is implicit (process-singleton) — multi-tenant deployments
 * that need per-user caches should construct `learnSuggestionsFromTelemetry`
 * directly instead.
 *
 * Caching policy (v1.5.0 dogfood H1 fix): the cache stores the UNFILTERED
 * set of rules (all transitions ≥ minSamples, no allowlist applied).
 * The allowlist + per-source-tool clamp are applied at READ time inside
 * `suggestNext()` so the same cached payload serves callers with
 * different allowlists. Pre-fix the cache silently honored the FIRST
 * caller's opts and ignored subsequent ones — a real correctness bug
 * because `enforceBudget → suggestNext(toolName)` passes no allowlist
 * (poisoning the cache) before `suggestNext` itself passes one (which
 * was then ignored).
 *
 * @public
 */
export function getLearnedRules(opts: LearnSuggestionsOptions = {}): LearnedRules {
  if (_cache && _cache.expiresAt > Date.now()) {
    // Apply caller's allowlist on the cached (unfiltered) payload.
    return filterRulesByAllowlist(_cache.rules, opts.registeredTools);
  }
  // Mine unfiltered, then store unfiltered. Pass through every other
  // opt (windowDays, sessionGapMs, minSamples, events) so the
  // expensive aggregation still respects them.
  const unfilteredRules = learnSuggestionsFromTelemetry({
    ...opts,
    registeredTools: undefined,
  });
  _cache = { rules: unfilteredRules, expiresAt: Date.now() + CACHE_TTL_MS };
  return filterRulesByAllowlist(unfilteredRules, opts.registeredTools);
}

/**
 * Apply a registered-tools allowlist to a pre-computed LearnedRules
 * map. Used by `getLearnedRules` to layer the per-caller allowlist on
 * top of the shared cache. Returns the input unchanged when no
 * allowlist is provided.
 */
function filterRulesByAllowlist(
  rules: LearnedRules,
  allowlist: ReadonlySet<string> | undefined,
): LearnedRules {
  if (!allowlist) return rules;
  const out: LearnedRules = {};
  for (const [from, suggestions] of Object.entries(rules)) {
    if (!allowlist.has(from)) continue;
    const kept = suggestions.filter((s) => allowlist.has(s.tool));
    if (kept.length > 0) out[from] = kept;
  }
  return out;
}
