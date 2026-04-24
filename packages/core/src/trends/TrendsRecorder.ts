import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import type { RecordOptions, TrendSnapshot } from './types.js';

const FILE_SUBPATH = path.join('.ctxloom', 'trends', 'snapshots.jsonl');
const ENTRY_PATTERN = /(^|\/)(index|main|server|app|cli)\.[^/]+$/;
const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;

function computeMetrics(opts: RecordOptions, unixSeconds: number): Pick<TrendSnapshot, 'totalFiles' | 'totalEdges' | 'deadFiles' | 'avgBusFactor' | 'highRiskFiles' | 'churnLinesLast7d'> {
  const { graph, overlay, gitEnabled } = opts;
  const files = graph.allFiles();

  let deadFiles = 0;
  for (const f of files) {
    const importers = graph.getImporters(f).length;
    if (importers === 0 && !ENTRY_PATTERN.test(f)) deadFiles++;
  }

  if (!gitEnabled) {
    return {
      totalFiles: files.length,
      totalEdges: graph.edgeCount(),
      deadFiles,
      avgBusFactor: null,
      highRiskFiles: null,
      churnLinesLast7d: null,
    };
  }

  let busSum = 0;
  let busCount = 0;
  for (const f of overlay.ownership.allNodes()) {
    const stats = overlay.ownership.statsFor(f);
    if (stats !== null) {
      busSum += stats.busFactor;
      busCount++;
    }
  }
  const avgBusFactor = busCount > 0 ? busSum / busCount : 0;

  let highRiskFiles = 0;
  let churnLinesLast7d = 0;
  const sevenDaysAgo = unixSeconds - SEVEN_DAYS_SECONDS;
  for (const f of files) {
    const churn = overlay.churn.statsFor(f);
    const ownership = overlay.ownership.statsFor(f);
    const coupled = overlay.coChange.topFor({ node: f, limit: 100, minConfidence: 0.1 });
    const churnLines = churn?.churnLines ?? 0;
    const bugDensity = churn?.bugDensity ?? 0;
    const busFactor = ownership?.busFactor ?? 1;
    const churnPart = Math.min(1, churnLines / 1000);
    const bugPart = Math.min(1, bugDensity * 2);
    const busPart = busFactor <= 1 ? 1 : busFactor <= 2 ? 0.5 : 0;
    const couplingPart = Math.min(1, coupled.length / 10);
    const score = churnPart * 0.3 + bugPart * 0.3 + busPart * 0.2 + couplingPart * 0.2;
    if (score > 0.6) highRiskFiles++;
    if (churn && churn.lastTouch >= sevenDaysAgo) {
      churnLinesLast7d += churn.churnLines;
    }
  }

  return {
    totalFiles: files.length,
    totalEdges: graph.edgeCount(),
    deadFiles,
    avgBusFactor: Math.round(avgBusFactor * 100) / 100,
    highRiskFiles,
    churnLinesLast7d,
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function recordTrendSnapshot(opts: RecordOptions): Promise<TrendSnapshot | null> {
  const now = opts.now ?? Date.now;
  const ms = now();
  const unixSeconds = Math.floor(ms / 1000);
  const timestamp = new Date(ms).toISOString();

  const filePath = path.join(opts.rootDir, FILE_SUBPATH);

  try {
    const metrics = computeMetrics(opts, unixSeconds);
    const snapshot: TrendSnapshot = {
      timestamp,
      unixSeconds,
      ...metrics,
      source: opts.source,
      gitSha: null,
    };

    await ensureDir(path.dirname(filePath));
    await fs.appendFile(filePath, JSON.stringify(snapshot) + '\n');

    return snapshot;
  } catch (err) {
    logger.warn('Failed to record trend snapshot', {
      file: filePath,
      detail: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
