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

const DEFAULT_TELEMETRY_DIR = path.join(os.homedir(), '.ctxloom', 'telemetry');

/**
 * Where the collector writes events. Override via
 * `CTXLOOM_TELEMETRY_DIR` env var (used in tests to point at a temp
 * dir; the env-var override also helps users who relocate their
 * `~/.ctxloom` to a shared / network-attached volume).
 */
export function telemetryDir(): string {
  return process.env.CTXLOOM_TELEMETRY_DIR ?? DEFAULT_TELEMETRY_DIR;
}

/**
 * Per-day filename. UTC so events emitted near midnight don't get
 * scattered across two local-time files on the same logical "day".
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
export function appendEvent(event: Omit<PersistedEvent, 'ts'>, now: Date = new Date()): void {
  try {
    const dir = telemetryDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, filenameForDate(now));
    const persisted: PersistedEvent = { ts: now.toISOString(), ...event };
    fs.appendFileSync(file, JSON.stringify(persisted) + '\n', 'utf-8');
  } catch {
    // Intentionally swallowed — see fn comment. The stderr-side
    // `logger.info()` in emitTelemetry already surfaced the event
    // for live observability; losing the disk persist is a stats-
    // visibility regression, not a correctness one.
  }
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
