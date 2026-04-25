import { Router } from 'express';
import { loadTrendSeries } from '@ctxloom/core';
import type { DashboardContext } from '../loader.js';
import type { TrendsResponse, TrendRange } from '../types.js';

const RANGE_TO_SECONDS: Record<Exclude<TrendRange, 'all'>, number> = {
  '7d': 7 * 24 * 3600,
  '30d': 30 * 24 * 3600,
  '90d': 90 * 24 * 3600,
};

function parseRange(raw: unknown): TrendRange {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all') return raw;
  return '30d';
}

function parseLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return 500;
  return Math.min(n, 5000);
}

export function buildTrendsRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const range = parseRange(req.query.range);
    const limit = parseLimit(req.query.limit);
    const sinceUnixSeconds =
      range === 'all' ? 0 : Math.floor(Date.now() / 1000) - RANGE_TO_SECONDS[range];

    const series = await loadTrendSeries({ rootDir: ctx.root, sinceUnixSeconds, limit });

    const body: TrendsResponse = {
      snapshots: series.snapshots,
      gitEnabled: series.gitEnabled,
      totalCount: series.totalCount,
      range,
    };
    res.json(body);
  });

  return router;
}
