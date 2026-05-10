import { Router } from 'express';
import { loadFileRiskHistory } from '@ctxloom/core';
import type { DashboardContext } from '../loader.js';
import type { FileRiskTrendsResponse } from '../types.js';

const RANGE_TO_SECONDS: Record<'7d' | '30d' | '90d', number> = {
  '7d': 7 * 24 * 3600,
  '30d': 30 * 24 * 3600,
  '90d': 90 * 24 * 3600,
};

function parseRange(raw: unknown): '7d' | '30d' | '90d' | 'all' {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all') return raw;
  return '90d';
}

function parseLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return 200;
  return Math.min(n, 2000);
}

export function buildFileTrendsRouter(ctx: DashboardContext): Router {
  const router = Router();

  /**
   * GET /api/trends/file?path=<repo-relative file>&range=<7d|30d|90d|all>
   *
   * Returns the score history for one file from the per-file sidecar
   * JSONL. Empty `points` is a normal response (file may have no
   * recorded points yet, or git was disabled when the project indexed).
   */
  router.get('/file', async (req, res) => {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!filePath) {
      return res.status(400).json({ error: "missing required query param 'path'" });
    }

    const range = parseRange(req.query.range);
    const limit = parseLimit(req.query.limit);
    const sinceUnixSeconds =
      range === 'all' ? 0 : Math.floor(Date.now() / 1000) - RANGE_TO_SECONDS[range];

    const history = await loadFileRiskHistory({
      rootDir: ctx.root,
      file: filePath,
      sinceUnixSeconds,
      limit,
    });

    const body: FileRiskTrendsResponse = {
      file: history.file,
      points: history.points.map(p => ({
        unixSeconds: p.unixSeconds,
        score: p.score,
        label: p.label,
      })),
      totalCount: history.totalCount,
      gitEnabled: ctx.gitEnabled,
    };
    res.json(body);
  });

  return router;
}
