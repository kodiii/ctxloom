import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { Skeletonizer } from '../../../../src/ast/Skeletonizer.js';
import type { DashboardContext } from '../loader.js';
import type { TokenStatsResponse } from '../types.js';

const CHARS_PER_TOKEN = 4;

let cache: { stats: TokenStatsResponse; indexedAt: number } | null = null;

export function buildTokensRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    if (cache && cache.indexedAt === ctx.lastIndexed.getTime()) {
      return res.json(cache.stats);
    }

    const files = ctx.graph.allFiles();
    const skeletonizer = new Skeletonizer();
    await skeletonizer.init();

    let fullChars = 0;
    let skeletonChars = 0;

    for (const file of files) {
      const absPath = path.join(ctx.root, file);
      try {
        const content = fs.readFileSync(absPath, 'utf-8');
        fullChars += content.length;
        const skeleton = await skeletonizer.skeletonize(absPath);
        skeletonChars += skeleton.length;
      } catch {
        // skip unreadable or non-skeletonizable files
      }
    }

    const fullTokens = Math.round(fullChars / CHARS_PER_TOKEN);
    const skeletonTokens = Math.round(skeletonChars / CHARS_PER_TOKEN);
    const savedTokens = fullTokens - skeletonTokens;
    const reductionPercent = fullTokens > 0 ? Math.round((savedTokens / fullTokens) * 100) : 0;

    const stats: TokenStatsResponse = { fullTokens, skeletonTokens, savedTokens, reductionPercent, fileCount: files.length };
    cache = { stats, indexedAt: ctx.lastIndexed.getTime() };

    return res.json(stats);
  });

  return router;
}
