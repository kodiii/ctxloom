import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import type { FileRiskHistory, FileRiskLoadOptions, FileRiskPoint } from './types.js';

const FILE_SUBPATH = path.join('.ctxloom', 'trends', 'file-risks.jsonl');
const DEFAULT_LIMIT = 200;

const VALID_LABELS = new Set(['low', 'medium', 'high', 'critical']);

function isValidPoint(value: unknown): value is FileRiskPoint {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.unixSeconds === 'number' &&
    typeof v.file === 'string' &&
    typeof v.score === 'number' &&
    typeof v.label === 'string' &&
    VALID_LABELS.has(v.label)
  );
}

/**
 * Read-side counterpart to the per-file risk recorder. Stream-parses
 * `${rootDir}/.ctxloom/trends/file-risks.jsonl`, filters to the
 * requested file path and time range, and returns ascending points.
 *
 * Tolerant to missing files, partial writes, and malformed lines.
 */
export async function loadFileRiskHistory(opts: FileRiskLoadOptions): Promise<FileRiskHistory> {
  const filePath = path.join(opts.rootDir, FILE_SUBPATH);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const sinceUnixSeconds = opts.sinceUnixSeconds ?? 0;

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return { file: opts.file, points: [], totalCount: 0 };
  }

  const allMatching: FileRiskPoint[] = [];
  let totalCount = 0;
  let malformed = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    if (!isValidPoint(value)) {
      malformed++;
      continue;
    }
    if (value.file !== opts.file) continue;
    totalCount++;
    if (value.unixSeconds < sinceUnixSeconds) continue;
    allMatching.push(value);
  }

  if (malformed > 0) {
    logger.warn('Skipped malformed file-risk rows', { file: filePath, count: malformed });
  }

  allMatching.sort((a, b) => a.unixSeconds - b.unixSeconds);
  const tail = allMatching.length > limit ? allMatching.slice(allMatching.length - limit) : allMatching;

  return { file: opts.file, points: tail, totalCount };
}
