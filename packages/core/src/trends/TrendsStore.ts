import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import type { LoadOptions, TrendSeries, TrendSnapshot } from './types.js';

const FILE_SUBPATH = path.join('.ctxloom', 'trends', 'snapshots.jsonl');
const DEFAULT_LIMIT = 500;
const DEFAULT_RANGE_SECONDS = 30 * 24 * 3600;

function isCompleteSnapshot(value: unknown): value is TrendSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.timestamp === 'string' &&
    typeof v.unixSeconds === 'number' &&
    typeof v.totalFiles === 'number' &&
    typeof v.totalEdges === 'number' &&
    typeof v.deadFiles === 'number' &&
    (v.avgBusFactor === null || typeof v.avgBusFactor === 'number') &&
    (v.highRiskFiles === null || typeof v.highRiskFiles === 'number') &&
    (v.churnLinesLast7d === null || typeof v.churnLinesLast7d === 'number') &&
    typeof v.source === 'string' &&
    (v.gitSha === null || typeof v.gitSha === 'string')
  );
}

/**
 * Read-side counterpart to TrendsRecorder. Stream-parses
 * `${rootDir}/.ctxloom/trends/snapshots.jsonl`, applies range/limit,
 * and returns a sorted ascending TrendSeries.
 *
 * Tolerant to missing files, partial writes, and malformed lines.
 */
export async function loadTrendSeries(opts: LoadOptions): Promise<TrendSeries> {
  const filePath = path.join(opts.rootDir, FILE_SUBPATH);
  const sinceUnixSeconds =
    opts.sinceUnixSeconds ?? Math.floor(Date.now() / 1000) - DEFAULT_RANGE_SECONDS;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return { snapshots: [], gitEnabled: false, totalCount: 0 };
  }

  const parsed: TrendSnapshot[] = [];
  let totalCount = 0;
  let malformed = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    totalCount++;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    if (!isCompleteSnapshot(value)) {
      malformed++;
      continue;
    }
    parsed.push(value);
  }

  if (malformed > 0) {
    logger.warn('Skipped malformed trend rows', { file: filePath, count: malformed });
  }

  parsed.sort((a, b) => a.unixSeconds - b.unixSeconds);

  const filtered = parsed.filter(s => s.unixSeconds >= sinceUnixSeconds);
  const tail = filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;

  const newest = tail[tail.length - 1];
  const gitEnabled =
    newest !== undefined &&
    (newest.avgBusFactor !== null ||
      newest.highRiskFiles !== null ||
      newest.churnLinesLast7d !== null);

  return { snapshots: tail, gitEnabled, totalCount };
}
