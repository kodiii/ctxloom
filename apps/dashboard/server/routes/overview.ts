import { Router } from 'express';
import { CommunityDetector } from '../../../../src/graph/CommunityDetector.js';
import type { DashboardContext } from '../loader.js';
import type { OverviewResponse } from '../types.js';
import {
  assignLabelsByPercentile,
  computeRiskBreakdown,
  computeRiskCaps,
  scoreFromBreakdown,
  type RawRiskMetrics,
} from '../lib/risk.js';

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
      const raw: RawRiskMetrics[] = files.map(f => {
        const churn = overlay.churn.statsFor(f);
        const ownership = overlay.ownership.statsFor(f);
        const coupled = overlay.coChange.topFor({ node: f, limit: 100, minConfidence: 0.1 });
        return {
          churnLines: churn?.churnLines ?? 0,
          bugDensity: churn?.bugDensity ?? 0,
          busFactor: ownership?.busFactor ?? 1,
          couplingFanOut: coupled.length,
        };
      });
      const caps = computeRiskCaps(raw);
      const scores = raw.map(m => scoreFromBreakdown(computeRiskBreakdown(m, caps)));
      const { labels } = assignLabelsByPercentile(scores);
      for (const label of labels) risk[label]++;
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
