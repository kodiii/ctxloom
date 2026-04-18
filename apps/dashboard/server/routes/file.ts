import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DashboardContext } from '../loader.js';

export function buildFileRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const rel = req.query.path as string | undefined;
    if (!rel) return res.status(400).json({ error: 'missing path' });

    const abs = path.resolve(ctx.root, rel);
    // security: must stay inside root
    if (!abs.startsWith(ctx.root)) return res.status(403).json({ error: 'forbidden' });

    try {
      const content = await fs.readFile(abs, 'utf-8');
      const ext = path.extname(abs).slice(1);
      res.json({ content, lines: content.split('\n').length, ext });
    } catch {
      res.status(404).json({ error: 'not found' });
    }
  });

  return router;
}
