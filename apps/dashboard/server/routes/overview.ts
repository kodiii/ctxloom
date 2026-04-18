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
        if (score > 0.8) risk.critical++;
        else if (score > 0.6) risk.high++;
        else if (score > 0.3) risk.medium++;
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
