import { Router } from 'express';
import type { DashboardContext } from '../loader.js';
import type { OwnershipResponse, OwnerEntry } from '../types.js';

export function buildOwnershipRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const { graph, overlay, gitEnabled } = ctx;

    if (!gitEnabled) {
      return res.json({ entries: [], totalAuthors: 0 } satisfies OwnershipResponse);
    }

    const authorSet = new Set<string>();
    const entries: OwnerEntry[] = graph.allFiles()
      .map(f => {
        const stats = overlay.ownership.statsFor(f);
        if (!stats || !stats.owners?.length) return null;
        const [primary, ...rest] = stats.owners;
        authorSet.add(primary.author);
        rest.forEach(o => authorSet.add(o.author));
        return {
          file: f,
          primaryOwner: primary.author,
          primaryShare: Math.round(primary.share * 100) / 100,
          busFactor: stats.busFactor,
          coOwners: rest.map(o => ({ author: o.author, share: Math.round(o.share * 100) / 100 })),
        };
      })
      .filter((e): e is OwnerEntry => e !== null)
      .sort((a, b) => a.busFactor - b.busFactor);

    res.json({ entries, totalAuthors: authorSet.size } satisfies OwnershipResponse);
  });

  return router;
}
