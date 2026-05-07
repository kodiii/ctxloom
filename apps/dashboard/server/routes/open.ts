import { Router } from 'express';
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { DashboardContext } from '../loader.js';

/**
 * Try to open `abs` using the given binary, passing the path as argv (NOT
 * concatenated into a shell string). Critical: `execFile` does not invoke
 * a shell, so backticks / `$()` / `;` in the path are inert. The previous
 * `exec(\`code ${JSON.stringify(abs)}\`)` was a shell-injection sink —
 * even with JSON.stringify quoting, backticks inside double-quoted shell
 * strings are still interpreted.
 */
function tryOpen(bin: string, abs: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile(bin, [abs], { timeout: 5000 }, err => resolve(!err));
  });
}

export function buildOpenRouter(ctx: DashboardContext): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const rel = req.body?.path as string | undefined;
    if (!rel || typeof rel !== 'string') return res.status(400).json({ error: 'missing path' });

    const abs = path.resolve(ctx.root, rel);
    // SECURITY: prefix-confusion guard — see file.ts for rationale.
    const rootBoundary = ctx.root.endsWith(path.sep) ? ctx.root : ctx.root + path.sep;
    if (abs !== ctx.root && !abs.startsWith(rootBoundary)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const opened =
      await tryOpen('code', abs) ||
      await tryOpen('cursor', abs) ||
      await tryOpen('open', abs);      // macOS fallback

    res.json({ ok: opened });
  });

  return router;
}
