import { Router } from 'express';
import type { DashboardContext } from '../loader.js';
import type { ChurnResponse, ChurnEntry } from '../types.js';

export function buildChurnRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;

    if (!gitEnabled) {
      return res.json({ entries: [] } satisfies ChurnResponse);
    }

    const entries: ChurnEntry[] = graph.allFiles()
      .map(f => {
        const stats = overlay.churn.statsFor(f);
        if (!stats) return null;
        const bucket: 'low' | 'medium' | 'high' =
          stats.churnLines > 500 ? 'high' : stats.churnLines > 100 ? 'medium' : 'low';
        return {
          file: f,
          churnLines: stats.churnLines,
          bucket,
          commits: stats.commits,
          bugDensity: Math.round(stats.bugDensity * 100) / 100,
        };
      })
      .filter((e): e is ChurnEntry => e !== null)
      .sort((a, b) => b.churnLines - a.churnLines);

    res.json({ entries } satisfies ChurnResponse);
  });

  return router;
}
