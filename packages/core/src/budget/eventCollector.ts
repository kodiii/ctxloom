/**
 * eventCollector.ts — disk sink for `mcp.budget.exceeded` and
 * `mcp.fallback.used` events.
 *
 * Phase B2 emits these events to stderr via the logger when
 * `CTXLOOM_TELEMETRY_LEVEL=full`, but nothing aggregates them across
 * a session — they're write-only. This module persists them to
 * `~/.ctxloom/telemetry/budget-events-<YYYY-MM-DD>.jsonl` (one file
 * per UTC day) so `ctxloom budget-stats` can re-derive per-tool p50/
 * p75/p95 from real usage.
 *
 * Privacy contract: events contain only event type + tool name +
 * token counts + mode/reason enums. NEVER any source content, file
 * path, query string, or user identifier. The shape mirrors the
 * existing emitTelemetry() event shape one-for-one with a timestamp
 * added.
 *
 * Rotation: per-day files. A 14-day stats window reads at most 14
 * small JSONL files. No deletion / GC implemented yet — disk usage
 * is bounded by event volume (~100 bytes per event × ~thousands of
 * events per day on a heavy CI account = sub-MB per day).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Persisted shape — adds `ts` to the emitTelemetry() payload.
 *
 * Stays a `Record<string, unknown>` so future event-shape evolution
 * (adding fields, soft-deprecating old ones) doesn't require a
 * schema migration. The aggregator narrows + validates fields it
 * actually uses at read time.
 */
export interface PersistedEvent extends Record<string, unknown> {
  ts: string;       // ISO-8601 timestamp
  event: string;    // 'mcp.budget.exceeded' | 'mcp.fallback.used'
  tool: string;     // 'ctx_get_file' etc.
}

/**
 * Input shape for `appendEvent`. Identical to `PersistedEvent` minus
 * the `ts` (which the collector stamps itself). Spelled out
 * explicitly rather than as `Omit<PersistedEvent, 'ts'>` because Omit
 * on an interface that extends `Record<string, unknown>` collapses
 * to the index signature and loses the required-key narrowing — TS
 * then refuses to assign `{ts, ...input}` to `PersistedEvent`.
 *
 * @internal — implementation detail of appendEvent's signature; not
 * part of the user-facing contract. External callers that want to
 * persist their own events should call `appendEvent` (whose param
 * type is inferred) rather than importing this directly. Marked per
 * ARCH-135-3 from PR #135's dogfood: narrowing the published API so
 * future param-shape evolution isn't a breaking change.
 */
export interface EventInput extends Record<string, unknown> {
  event: string;
  tool: string;
}

const DEFAULT_TELEMETRY_DIR = path.join(os.homedir(), '.ctxloom', 'telemetry');

/**
 * Where the collector writes events. Override via
 * `CTXLOOM_TELEMETRY_DIR` env var (used in tests to point at a temp
 * dir; the env-var override also helps users who relocate their
 * `~/.ctxloom` to a shared / network-attached volume).
 *
 * @internal — control the directory via the env var, not by calling
 * this. Marked per ARCH-135-3 from PR #135's dogfood: the function
 * is exported for tests but is not part of the user-facing contract;
 * the env-var IS the contract.
 */
export function telemetryDir(): string {
  const raw = process.env.CTXLOOM_TELEMETRY_DIR ?? DEFAULT_TELEMETRY_DIR;
  // Defense in depth (#142): if an operator typo or env-injection
  // elsewhere supplies a path-traversal-style or non-absolute value,
  // refuse it rather than silently creating directories under the
  // wrong root. If `CTXLOOM_TELEMETRY_DIR` is malformed we fall back
  // to the safe default — telemetry is best-effort, so silently
  // logging once + using the default is the right failure mode
  // (vs. throwing, which would break tool calls via the swallowed
  // appendEvent try/catch and yield zero operator signal).
  // NB: `path.resolve(relative)` would silently absolve a relative
  // path against cwd; we want to reject relatives, so check the
  // RAW value's absolute-ness — not the resolved form.
  if (raw.includes('..') || !path.isAbsolute(raw)) {
    if (!telemetryDirWarned) {
      telemetryDirWarned = true;
      logger.warn('CTXLOOM_TELEMETRY_DIR rejected — must be an absolute path with no ".." segments; using default', {
        rejected: raw,
        fallback: DEFAULT_TELEMETRY_DIR,
      });
    }
    return DEFAULT_TELEMETRY_DIR;
  }
  return path.resolve(raw);
}

// Module-scope once-flag (#142): prevents log flooding when a
// misconfigured env var triggers telemetryDir() on every event.
let telemetryDirWarned = false;

/**
 * Per-day filename. UTC so events emitted near midnight don't get
 * scattered across two local-time files on the same logical "day".
 *
 * @internal — implementation detail of the on-disk layout. External
 * callers that need the path for a given date should derive it
 * themselves; the filename shape is an internal convention that may
 * evolve (e.g. weekly rotation). Marked per ARCH-135-3.
 */
export function filenameForDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `budget-events-${y}-${m}-${d}.jsonl`;
}

/**
 * Append one event to today's JSONL file. Creates the telemetry
 * dir lazily and uses `appendFileSync` for crash-consistent writes
 * (vs an open WriteStream that could lose unflushed events on
 * abnormal exit). Each event is ~100 bytes; sync I/O cost is sub-ms
 * on local disk and the call site (`emitTelemetry`) only fires on
 * budget breaches, not every tool call.
 *
 * Crash isolation: write errors (disk full, perm denied, etc.) are
 * caught + ignored. Telemetry MUST NEVER take down the MCP server
 * — its only job is to make stats possible later, not to be
 * load-bearing for the request that triggered the event.
 *
 * @public
 */
export function appendEvent(event: EventInput, now: Date = new Date()): void {
  try {
    const dir = telemetryDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, filenameForDate(now));
    const persisted: PersistedEvent = { ts: now.toISOString(), ...event };
    fs.appendFileSync(file, JSON.stringify(persisted) + '\n', 'utf-8');
  } catch (err) {
    // Surface the FIRST failure (#143) so an operator gets one
    // signal that telemetry persistence is broken — EACCES, ENOSPC,
    // EROFS, write-protected mount, misconfigured TELEMETRY_DIR, etc.
    // Subsequent failures in the same process are swallowed silently
    // to avoid log flooding on a persistent error. The MCP server
    // still never faults on a telemetry error — telemetry is
    // observability, not correctness.
    if (!appendFailureWarned) {
      appendFailureWarned = true;
      logger.warn('telemetry sink append failed (further failures suppressed)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Module-scope once-flag (#143): first appendFileSync failure logs
// a single warn; subsequent failures are silent.
let appendFailureWarned = false;

/**
 * Test-only: reset the module-scope once-flags so tests can assert
 * the "first failure warns, subsequent failures silent" contract
 * without depending on test execution order.
 *
 * @internal — not part of the public API; exported for test hooks
 * only.
 */
export function __resetTelemetryWarnFlagsForTests(): void {
  telemetryDirWarned = false;
  appendFailureWarned = false;
}

export interface ReadEventsOptions {
  /** Inclusive lower bound. Default: 14 days before `until`. */
  since?: Date;
  /** Inclusive upper bound. Default: now. */
  until?: Date;
  /** When set, drop events whose `tool` field doesn't match. */
  tool?: string;
}

/**
 * Read all persisted events from disk in `[since, until]`. Files
 * outside the date window are skipped without parsing. Malformed
 * lines (truncated JSON from a crash mid-write, manual edits) are
 * skipped silently with no I/O fanfare — the stats become slightly
 * less accurate, the CLI doesn't crash.
 *
 * @public
 */
export function readEvents(opts: ReadEventsOptions = {}): PersistedEvent[] {
  const until = opts.until ?? new Date();
  const since = opts.since ?? new Date(until.getTime() - 14 * 24 * 60 * 60 * 1000);
  const dir = telemetryDir();
  if (!fs.existsSync(dir)) return [];

  const out: PersistedEvent[] = [];

  // Walk every day in the window and try to open its file. Cheap on
  // 14-day windows; we'd need an index if windows grew to months.
  for (let cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
       cursor.getTime() <= until.getTime();
       cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
    const file = path.join(dir, filenameForDate(cursor));
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf-8');
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // skip malformed
      }
      if (!isPersistedEvent(parsed)) continue;
      // Boundary filter — files are date-bucketed but individual
      // events still need a precise timestamp check at the edges.
      const eventTs = new Date(parsed.ts).getTime();
      // Skip malformed dates (#144): `new Date('not-a-date').getTime()`
      // is NaN, and `NaN < x || NaN > x` are BOTH false — so without
      // this guard a corrupted timestamp would silently pass the
      // boundary filter and contaminate budget-stats percentile
      // calculations downstream.
      if (!Number.isFinite(eventTs)) continue;
      if (eventTs < since.getTime() || eventTs > until.getTime()) continue;
      if (opts.tool && parsed.tool !== opts.tool) continue;
      out.push(parsed);
    }
  }

  return out;
}

function isPersistedEvent(v: unknown): v is PersistedEvent {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.ts === 'string' && typeof o.event === 'string' && typeof o.tool === 'string';
}

// ─── TelemetrySink — injectable transport ────────────────────────────

/**
 * A pluggable transport for telemetry events. The default
 * implementation (`diskSink` below) writes JSONL to
 * `~/.ctxloom/telemetry/` via `appendEvent`. Alternate sinks make
 * sense for:
 *
 *   - tests (in-memory ring buffer; asserts events without
 *     touching the disk or scoping CTXLOOM_TELEMETRY_DIR)
 *   - the web dashboard (in-process ring buffer feeding a live
 *     UI panel)
 *   - external observability backends (a Sentry-breadcrumb sink,
 *     an OpenTelemetry exporter, etc.)
 *
 * Closes ARCH-135-1 from PR #135's dogfood: pre-refactor every
 * caller of `emitTelemetry` transitively pulled in the disk sink
 * via static import. With the sink behind an interface and threaded
 * through `EnforceBudgetOptions.sink`, callers can pick their
 * transport explicitly and only the bootstrap site knows about disk
 * persistence.
 *
 * @public
 */
export interface TelemetrySink {
  /**
   * Best-effort append. MUST swallow errors — telemetry is
   * observability, not correctness; a sink failure must never
   * propagate to the caller and surface as a tool-call error.
   * The default `diskSink` enforces this; custom sinks should too.
   */
  append(event: EventInput): void;
}

/**
 * Default sink — writes to `~/.ctxloom/telemetry/budget-events-<UTC-day>.jsonl`
 * via the existing `appendEvent` function. Error-swallowing is
 * inherited from `appendEvent`'s try/catch.
 *
 * @public
 */
export const diskSink: TelemetrySink = {
  append(event: EventInput): void {
    appendEvent(event);
  },
};
