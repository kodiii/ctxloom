import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import {
  scoreAll,
  SCORE_FLOOR,
  type RawRiskMetrics,
  type RiskLabel,
} from '../risk/scoring.js';
import type { FileRiskPoint, RecordOptions, TrendSnapshot } from './types.js';

const FILE_SUBPATH = path.join('.ctxloom', 'trends', 'snapshots.jsonl');
const FILE_RISKS_SUBPATH = path.join('.ctxloom', 'trends', 'file-risks.jsonl');
const ENTRY_PATTERN = /(^|\/)(index|main|server|app|cli)\.[^/]+$/;
const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;
const COLLAPSE_WINDOW_SECONDS = 300;
const PERCENT_THRESHOLD = 0.01;
const FILE_SCORE_DELTA = 0.02;
const INTEGER_FLOOR_FIELDS: ReadonlyArray<keyof TrendSnapshot> = [
  'totalFiles',
  'totalEdges',
  'deadFiles',
  'highRiskFiles',
];

interface PerFileMetrics {
  file: string;
  raw: RawRiskMetrics;
}

interface ComputedAggregates {
  metrics: Pick<TrendSnapshot, 'totalFiles' | 'totalEdges' | 'deadFiles' | 'avgBusFactor' | 'highRiskFiles' | 'churnLinesLast7d'>;
  perFileScores: FileRiskPoint[];
}

function gatherPerFileMetrics(opts: RecordOptions): PerFileMetrics[] {
  const { graph, overlay } = opts;
  return graph.allFiles().map(f => {
    const churn = overlay.churn.statsFor(f);
    const ownership = overlay.ownership.statsFor(f);
    const coupled = overlay.coChange.topFor({ node: f, limit: 100, minConfidence: 0.1 });
    return {
      file: f,
      raw: {
        churnLines: churn?.churnLines ?? 0,
        bugDensity: churn?.bugDensity ?? 0,
        busFactor: ownership?.busFactor ?? 1,
        couplingFanOut: coupled.length,
      },
    };
  });
}

function computeAggregates(opts: RecordOptions, unixSeconds: number): ComputedAggregates {
  const { graph, gitEnabled } = opts;
  const files = graph.allFiles();

  let deadFiles = 0;
  for (const f of files) {
    const importers = graph.getImporters(f).length;
    if (importers === 0 && !ENTRY_PATTERN.test(f)) deadFiles++;
  }

  if (!gitEnabled) {
    return {
      metrics: {
        totalFiles: files.length,
        totalEdges: graph.edgeCount(),
        deadFiles,
        avgBusFactor: null,
        highRiskFiles: null,
        churnLinesLast7d: null,
      },
      perFileScores: [],
    };
  }

  // Bus-factor average (knowledge concentration is a project-wide signal —
  // tracked separately from the score, which is intrinsic-only).
  let busSum = 0;
  let busCount = 0;
  for (const f of opts.overlay.ownership.allNodes()) {
    const stats = opts.overlay.ownership.statsFor(f);
    if (stats !== null) {
      busSum += stats.busFactor;
      busCount++;
    }
  }
  const avgBusFactor = busCount > 0 ? busSum / busCount : 0;

  // Recent churn — independent of risk scoring.
  const sevenDaysAgo = unixSeconds - SEVEN_DAYS_SECONDS;
  let churnLinesLast7d = 0;
  for (const f of files) {
    const churn = opts.overlay.churn.statsFor(f);
    if (churn && churn.lastTouch >= sevenDaysAgo) {
      churnLinesLast7d += churn.churnLines;
    }
  }

  // Per-file risk via the unified scoring lib (single source of truth
  // shared with the dashboard's /api/risk route).
  const perFile = gatherPerFileMetrics(opts);
  const { scored } = scoreAll(perFile.map(p => p.raw));

  // `highRiskFiles` is now the percentile-banded count of files in the
  // 'critical' OR 'high' bands (top 15% by intrinsic risk). The field
  // name and shape are preserved for backwards compat with old snapshots
  // already on disk; the semantics moved from "score > 0.6" (absolute,
  // bus-inflated) to "top 15% by intrinsic risk".
  let highRiskFiles = 0;
  const perFileScores: FileRiskPoint[] = [];
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i];
    const file = perFile[i].file;
    if (s.label === 'critical' || s.label === 'high') highRiskFiles++;
    if (s.score >= SCORE_FLOOR) {
      perFileScores.push({
        unixSeconds,
        file,
        score: Math.round(s.score * 100) / 100,
        label: s.label,
      });
    }
  }

  return {
    metrics: {
      totalFiles: files.length,
      totalEdges: graph.edgeCount(),
      deadFiles,
      avgBusFactor: Math.round(avgBusFactor * 100) / 100,
      highRiskFiles,
      churnLinesLast7d,
    },
    perFileScores,
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readLastLine(filePath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(filePath);
    if (buf.length === 0) return null;
    const text = buf.toString('utf-8').replace(/\n+$/, '');
    const idx = text.lastIndexOf('\n');
    return idx >= 0 ? text.slice(idx + 1) : text;
  } catch {
    return null;
  }
}

async function readLastSnapshot(filePath: string): Promise<TrendSnapshot | null> {
  const line = await readLastLine(filePath);
  if (line === null || line.trim() === '') return null;
  try {
    return JSON.parse(line) as TrendSnapshot;
  } catch {
    return null;
  }
}

function shouldCollapse(prev: TrendSnapshot, next: TrendSnapshot): boolean {
  if (next.unixSeconds - prev.unixSeconds >= COLLAPSE_WINDOW_SECONDS) return false;

  const nullableKeys: ReadonlyArray<keyof TrendSnapshot> = [
    'avgBusFactor', 'highRiskFiles', 'churnLinesLast7d',
  ];
  for (const key of nullableKeys) {
    if ((prev[key] === null) !== (next[key] === null)) return false;
  }

  for (const key of INTEGER_FLOOR_FIELDS) {
    const a = prev[key];
    const b = next[key];
    if (typeof a === 'number' && typeof b === 'number' && Math.abs(b - a) >= 1) {
      return false;
    }
  }

  const numericKeys: ReadonlyArray<keyof TrendSnapshot> = [
    'totalFiles', 'totalEdges', 'deadFiles', 'avgBusFactor', 'highRiskFiles', 'churnLinesLast7d',
  ];
  for (const key of numericKeys) {
    const a = prev[key];
    const b = next[key];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (a === 0) {
      if (b !== 0) return false;
      continue;
    }
    if (Math.abs((b - a) / a) > PERCENT_THRESHOLD) return false;
  }

  return true;
}

/**
 * Replace the last line of the JSONL file with `replacement` (newline-terminated).
 *
 * NOTE on concurrency: this is a read-modify-write cycle and is NOT atomic.
 * If two processes simultaneously decide to collapse, the second write wins
 * and the first row is lost. The append path (fs.appendFile, O_APPEND) IS
 * atomic for lines under PIPE_BUF, so concurrent appends never interleave.
 * At current project scale (few concurrent recorders), data loss is rare.
 * If this becomes a problem, wrap in a file lock (e.g. proper-lockfile).
 */
async function overwriteLastLine(filePath: string, replacement: string): Promise<void> {
  const buf = await fs.readFile(filePath);
  const text = buf.toString('utf-8');
  const trimmed = text.replace(/\n+$/, '');
  const idx = trimmed.lastIndexOf('\n');
  const head = idx >= 0 ? trimmed.slice(0, idx + 1) : '';
  await fs.writeFile(filePath, head + replacement + '\n');
}

/**
 * Build a Map of file → most-recent score from the sidecar JSONL.
 * Tolerant to malformed lines (skip + warn). Used to dedupe per-file
 * appends so we don't re-record points whose score is essentially
 * unchanged since the previous recording event.
 */
async function loadLastScoresPerFile(filePath: string): Promise<Map<string, FileRiskPoint>> {
  const out = new Map<string, FileRiskPoint>();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line) as FileRiskPoint;
        if (typeof p?.file === 'string' && typeof p.score === 'number') {
          out.set(p.file, p);
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file may not exist yet
  }
  return out;
}

async function appendFilteredPerFileScores(
  filePath: string,
  next: FileRiskPoint[],
  prev: Map<string, FileRiskPoint>,
): Promise<number> {
  const lines: string[] = [];
  for (const p of next) {
    const last = prev.get(p.file);
    const labelChanged = last?.label !== p.label;
    const scoreMoved = last === undefined || Math.abs(p.score - last.score) >= FILE_SCORE_DELTA;
    if (labelChanged || scoreMoved) lines.push(JSON.stringify(p));
  }
  if (lines.length === 0) return 0;
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, lines.join('\n') + '\n');
  return lines.length;
}

export async function recordTrendSnapshot(opts: RecordOptions): Promise<TrendSnapshot | null> {
  const now = opts.now ?? Date.now;
  const ms = now();
  const unixSeconds = Math.floor(ms / 1000);
  const timestamp = new Date(ms).toISOString();

  const filePath = path.join(opts.rootDir, FILE_SUBPATH);
  const fileRisksPath = path.join(opts.rootDir, FILE_RISKS_SUBPATH);

  try {
    const { metrics, perFileScores } = computeAggregates(opts, unixSeconds);
    const snapshot: TrendSnapshot = {
      timestamp,
      unixSeconds,
      ...metrics,
      source: opts.source,
      gitSha: null,
    };

    await ensureDir(path.dirname(filePath));

    const prev = await readLastSnapshot(filePath);
    if (prev !== null && shouldCollapse(prev, snapshot)) {
      await overwriteLastLine(filePath, JSON.stringify(snapshot));
    } else {
      await fs.appendFile(filePath, JSON.stringify(snapshot) + '\n');
    }

    // Per-file points are recorded sparsely: only files whose score moved
    // by ≥ FILE_SCORE_DELTA OR whose label changed since the last recording
    // for that file. Keeps the sidecar file linear in *real* changes
    // rather than O(files × indexing events).
    if (perFileScores.length > 0) {
      const lastScores = await loadLastScoresPerFile(fileRisksPath);
      await appendFilteredPerFileScores(fileRisksPath, perFileScores, lastScores);
    }

    return snapshot;
  } catch (err) {
    logger.warn('Failed to record trend snapshot', {
      file: filePath,
      detail: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
