import type { RecordOptions, TrendSnapshot } from './types.js';

/**
 * Compute the current metrics and append (or collapse) a row in
 * `${rootDir}/.ctxloom/trends/snapshots.jsonl`.
 *
 * Returns the row that was persisted, or null on error.
 * Never throws — failures are logged and swallowed so the caller's
 * indexing pipeline is never broken by trend recording.
 */
export async function recordTrendSnapshot(
  _opts: RecordOptions,
): Promise<TrendSnapshot | null> {
  throw new Error('not implemented');
}
