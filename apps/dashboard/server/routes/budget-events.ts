/**
 * /api/budget-events — aggregated view of the budget-telemetry events
 * the MCP server has written to ~/.ctxloom/telemetry/budget-events-*.jsonl
 * via `appendEvent()` (the same data source as `ctxloom budget-stats`).
 *
 * Strategy: reuse `readEvents()` + `summarizeBudgetEvents()` from
 * `@ctxloom/core` so the dashboard view matches the CLI's numbers
 * exactly — no parallel aggregation logic to keep in sync.
 *
 * Query params:
 *   - `window` (string, e.g. "7d", "14d", "30d") — defaults to "14d".
 *     Parsed via the same regex `ctxloom budget-stats --window=` uses
 *     for parity.
 *   - `tool` (string) — optional filter; only events for this tool
 *     are aggregated. Mirrors the CLI's `--tool=<name>` flag.
 *
 * Response shape (200 OK):
 *   {
 *     window: { since: ISO, until: ISO, days: 14 },
 *     totalEvents: number,
 *     fallbackTable: FallbackRow[],
 *     distributionTable: DistributionRow[],
 *     breachesPerDay: Array<{ day: 'YYYY-MM-DD'; count: number }>
 *   }
 *
 * `breachesPerDay` is added on top of the CLI's summary because the
 * dashboard renders a sparkline that the CLI doesn't — pure additive
 * derivation, no duplication of `summarize()`'s output.
 *
 * Errors:
 *   - 400 on invalid `window` (matches CLI exit code 1 behavior)
 *   - 500 on telemetry I/O failure (rare — `readEvents` swallows most)
 */
import { Router } from 'express';
import {
  readEvents,
  summarizeBudgetEvents,
  type PersistedEvent,
} from '@ctxloom/core';

/** Mirrors the CLI's window parser (e.g. "14d" → 14). */
function parseWindowDays(raw: string | undefined): { days: number } | { error: string } {
  if (!raw) return { days: 14 };
  const m = /^(\d+)d$/.exec(raw);
  if (!m) return { error: `Invalid --window "${raw}". Expected format: 1d, 7d, 14d, 30d` };
  const days = parseInt(m[1], 10);
  if (!Number.isFinite(days) || days <= 0) {
    return { error: `Invalid --window "${raw}". Must be a positive integer day count.` };
  }
  return { days };
}

/**
 * Group events by UTC day for the sparkline. Counts only
 * `mcp.budget.exceeded` events (each represents one breach, which is
 * what users care about — `mcp.fallback.used` is a downstream
 * consequence of the same breach so double-counting would inflate
 * the visual).
 */
function breachesPerDay(events: PersistedEvent[]): Array<{ day: string; count: number }> {
  const buckets = new Map<string, number>();
  for (const e of events) {
    if (e.event !== 'mcp.budget.exceeded') continue;
    const day = e.ts.slice(0, 10); // 'YYYY-MM-DD' prefix of ISO timestamp
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function buildBudgetEventsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const windowRaw = typeof req.query.window === 'string' ? req.query.window : undefined;
    const toolFilter = typeof req.query.tool === 'string' && req.query.tool.length > 0
      ? req.query.tool
      : undefined;

    const parsed = parseWindowDays(windowRaw);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { days } = parsed;

    const until = new Date();
    const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      const events = readEvents({ since, until, tool: toolFilter });
      const summary = summarizeBudgetEvents(events, since, until);
      res.json({
        window: { since: since.toISOString(), until: until.toISOString(), days },
        totalEvents: summary.totalEvents,
        fallbackTable: summary.fallbackTable,
        distributionTable: summary.distributionTable,
        breachesPerDay: breachesPerDay(events),
      });
    } catch (err) {
      // readEvents swallows file-level I/O errors; this catches the
      // rare structural failure (corrupted home dir, etc).
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
