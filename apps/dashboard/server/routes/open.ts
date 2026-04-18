import { Router } from 'express';
import { exec } from 'node:child_process';
import path from 'node:path';
import type { DashboardContext } from '../loader.js';

function tryOpen(cmd: string): Promise<boolean> {
  return new Promise(resolve => {
    exec(cmd, err => resolve(!err));
  });
}

export function buildOpenRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const rel = req.body?.path as string | undefined;
    if (!rel) return res.status(400).json({ error: 'missing path' });

    const abs = path.resolve(ctx.root, rel);
    if (!abs.startsWith(ctx.root)) return res.status(403).json({ error: 'forbidden' });

    const escaped = JSON.stringify(abs);
    const opened =
      await tryOpen(`code ${escaped}`) ||
      await tryOpen(`cursor ${escaped}`) ||
      await tryOpen(`open ${escaped}`);      // macOS fallback

    res.json({ ok: opened });
  });

  return router;
}
