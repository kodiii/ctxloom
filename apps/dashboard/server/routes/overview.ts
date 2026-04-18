import { Router } from 'express';
import { CommunityDetector } from '../../../../src/graph/CommunityDetector.js';
import type { DashboardContext } from '../loader.js';
import type { OverviewResponse } from '../types.js';

export function buildOverviewRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;
    const files = graph.allFiles();

    const detector = new CommunityDetector(graph);
    const communities = files.length > 0 ? detector.detect() : [];

    const hubList = files
      .map(f => ({
        file: f,
        inDegree: graph.getImporters(f).length,
        outDegree: graph.getImports(f).length,
        totalDegree: graph.getImporters(f).length + graph.getImports(f).length,
      }))
      .sort((a, b) => b.totalDegree - a.totalDegree)
      .slice(0, 10);

    const risk = { critical: 0, high: 0, medium: 0, low: 0 };
    if (gitEnabled) {
      for (const f of files) {
        const churn = overlay.churn.statsFor(f);
        if (!churn) { risk.low++; continue; }
        if (churn.churnLines > 1000) risk.critical++;
        else if (churn.churnLines > 500) risk.high++;
        else if (churn.churnLines > 100) risk.medium++;
        else risk.low++;
      }
    }

    const body: OverviewResponse = {
      totalFiles: files.length,
      totalEdges: graph.edgeCount(),
      totalCommunities: communities.length,
      risk,
      topHubs: hubList,
      gitEnabled,
    };

    res.json(body);
  });

  return router;
}
