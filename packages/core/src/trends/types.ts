/**
 * Public types for the trends subsystem.
 *
 * A TrendSnapshot is a single point in time capturing code-health metrics.
 * The recorder emits these into an append-only JSONL file as a side-effect
 * of every indexing event; the store reads them back for the dashboard.
 */

import type { DependencyGraph, GitOverlayStore } from '../index.js';

export type TrendSource = 'watcher' | 'mcp' | 'cli' | 'dashboard' | 'manual';

export interface TrendSnapshot {
  /** ISO-8601 UTC, e.g. "2026-04-25T14:37:02.145Z" */
  timestamp: string;
  /** Unix seconds — redundant with timestamp, cheap to sort/filter by. */
  unixSeconds: number;

  // graph-derived (always present)
  totalFiles: number;
  totalEdges: number;
  /** Files with zero importers AND not an entry point. */
  deadFiles: number;

  // git-derived (null when gitEnabled=false)
  /** Mean busFactor across all files with ≥1 commit. */
  avgBusFactor: number | null;
  /** Files whose risk score > 0.6. */
  highRiskFiles: number | null;
  /** Σ (added+deleted) across commits in the last 7 calendar days. */
  churnLinesLast7d: number | null;

  // provenance
  source: TrendSource;
  /** Short-SHA of HEAD at record time, or null if not a git repo. */
  gitSha: string | null;
}

export interface TrendSeries {
  /** Ascending by timestamp. */
  snapshots: TrendSnapshot[];
  gitEnabled: boolean;
  /** Total rows on disk (may exceed snapshots.length when bounded by limit). */
  totalCount: number;
}

export interface RecordOptions {
  graph: DependencyGraph;
  overlay: GitOverlayStore;
  gitEnabled: boolean;
  rootDir: string;
  source: TrendSource;
  /** Override "now" for testing. Default: Date.now */
  now?: () => number;
}

export interface LoadOptions {
  rootDir: string;
  /** Only return rows with unixSeconds >= this. Default: now - 30 days. */
  sinceUnixSeconds?: number;
  /** Max rows to return (newest N if series is longer). Default: 500. */
  limit?: number;
}

/**
 * One observation of a single file's risk score at a point in time.
 *
 * Stored sparsely in `.ctxloom/trends/file-risks.jsonl` — one line per
 * (timestamp, file) pair. The recorder only emits files whose score is
 * meaningful (>= SCORE_FLOOR) AND whose score has changed materially
 * since the last recording, to keep the file from growing without
 * bound on every indexing event.
 */
export interface FileRiskPoint {
  /** Unix seconds — matches the parent TrendSnapshot.unixSeconds. */
  unixSeconds: number;
  /** Repo-relative path. */
  file: string;
  /** Intrinsic risk score in [0, 1], rounded to 2 decimals. */
  score: number;
  /** Percentile-banded label as of this recording. */
  label: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Time series of risk scores for one specific file.
 *
 * Returned by loadFileRiskHistory(). Ascending by timestamp.
 */
export interface FileRiskHistory {
  file: string;
  points: FileRiskPoint[];
  /** Total points on disk for this file (may exceed points.length when bounded). */
  totalCount: number;
}

export interface FileRiskLoadOptions {
  rootDir: string;
  /** Repo-relative file path to load history for. */
  file: string;
  /** Only return points with unixSeconds >= this. Default: no filter. */
  sinceUnixSeconds?: number;
  /** Max points to return (newest N). Default: 200. */
  limit?: number;
}
