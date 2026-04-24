import type { LoadOptions, TrendSeries } from './types.js';

/**
 * Read-side counterpart to TrendsRecorder. Stream-parses
 * `${rootDir}/.ctxloom/trends/snapshots.jsonl`, applies range/limit,
 * and returns a sorted ascending TrendSeries.
 *
 * Tolerant to missing files, partial writes, and malformed lines.
 */
export async function loadTrendSeries(
  _opts: LoadOptions,
): Promise<TrendSeries> {
  throw new Error('not implemented');
}
