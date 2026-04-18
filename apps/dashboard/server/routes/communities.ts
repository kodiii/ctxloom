import { Router } from 'express';
import { CommunityDetector } from '../../../../src/graph/CommunityDetector.js';
import type { DashboardContext } from '../loader.js';
import type { CommunitiesResponse } from '../types.js';

export function buildCommunitiesRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph } = ctx;
    const files = graph.allFiles();

    if (files.length === 0) {
      const body: CommunitiesResponse = { communities: [], totalFiles: 0, totalEdges: 0 };
      return res.json(body);
    }

    const detector = new CommunityDetector(graph);
    const raw = detector.detect();
    const communities = raw
      .sort((a, b) => b.files.length - a.files.length)
      .map(c => ({ id: c.id, name: c.name, size: c.files.length, files: c.files }));

    res.json({ communities, totalFiles: files.length, totalEdges: graph.edgeCount() } satisfies CommunitiesResponse);
  });

  return router;
}
