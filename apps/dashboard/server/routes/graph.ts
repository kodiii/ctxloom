import { Router } from 'express';
import { CommunityDetector } from '../../../../src/graph/CommunityDetector.js';
import type { DashboardContext } from '../loader.js';
import type { GraphResponse, GraphNode, GraphEdge } from '../types.js';

export function buildGraphRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;
    const files = graph.allFiles();

    const communityMap = new Map<string, number>();
    if (files.length > 0) {
      const detector = new CommunityDetector(graph);
      const communities = detector.detect();
      for (const c of communities) {
        for (const f of c.files) communityMap.set(f, c.id);
      }
    }

    const nodes: GraphNode[] = files.map(f => {
      const churn = gitEnabled ? overlay.churn.statsFor(f) : null;
      const riskScore = churn ? Math.min(1, churn.churnLines / 1000) : null;
      return {
        id: f,
        label: f.split('/').pop() ?? f,
        community: communityMap.get(f) ?? 0,
        inDegree: graph.getImporters(f).length,
        outDegree: graph.getImports(f).length,
        riskScore,
      };
    });

    const edgeSet = new Set<string>();
    const edges: GraphEdge[] = [];
    for (const f of files) {
      for (const imp of graph.getImports(f)) {
        const key = `${f}→${imp}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ source: f, target: imp });
        }
      }
    }

    const body: GraphResponse = { nodes, edges };
    res.json(body);
  });

  return router;
}
