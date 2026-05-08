/**
 * /api/projects — list, get-active, set-active for the multi-project
 * dashboard switcher.
 *
 * The active project is held by the server in the existing
 * `DashboardContext` (mutated in place via `switchContext`). The
 * file watcher follows the active project — switching tears down
 * the old watcher and the caller (dashboard server) re-attaches it
 * via the `onActiveChanged` hook.
 *
 * Errors:
 *   - 404 when the requested slug isn't in the candidate list
 *   - 500 with the underlying error message when load/index fails
 *     (e.g. the project root no longer exists on disk)
 */
import { Router } from 'express';
import path from 'node:path';
import type { DashboardContext } from '../loader.js';
import { switchContext } from '../loader.js';
import { listProjects, slugFor, type DashboardProject } from '../projects.js';

export interface ProjectsRouterDeps {
  ctx: DashboardContext;
  defaultRoot: string;
  /** Called with the new root after a successful switch. The server
   *  uses this to tear down the file watcher on the old root and
   *  re-arm it on the new root. */
  onActiveChanged: (newRoot: string) => Promise<void> | void;
}

interface ProjectListItem extends DashboardProject {
  isActive: boolean;
}

export function buildProjectsRouter(deps: ProjectsRouterDeps): Router {
  const { ctx, defaultRoot, onActiveChanged } = deps;
  const router = Router();

  function annotated(): ProjectListItem[] {
    const activeSlug = slugFor(ctx.root);
    return listProjects(defaultRoot).map((p) => ({
      ...p,
      isActive: p.slug === activeSlug,
    }));
  }

  router.get('/', (_req, res) => {
    res.json({ projects: annotated() });
  });

  router.get('/active', (_req, res) => {
    const activeSlug = slugFor(ctx.root);
    const active = annotated().find((p) => p.slug === activeSlug);
    if (!active) {
      // Should never happen — the active root is always part of the list.
      res.status(500).json({ error: 'active project not found in candidate list' });
      return;
    }
    res.json({ active });
  });

  router.post('/active', async (req, res) => {
    const slug = (req.body as { slug?: unknown })?.slug;
    if (typeof slug !== 'string' || slug.length === 0) {
      res.status(400).json({ error: 'body must include a "slug" string' });
      return;
    }
    const target = listProjects(defaultRoot).find((p) => p.slug === slug);
    if (!target) {
      res.status(404).json({ error: `unknown project slug: ${slug}` });
      return;
    }
    if (slugFor(ctx.root) === target.slug) {
      // Already active — no-op success.
      res.json({ active: { ...target, isActive: true } });
      return;
    }
    try {
      await switchContext(ctx, target.root);
      await onActiveChanged(target.root);
      res.json({ active: { ...target, isActive: true } });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Best-effort: tell the client what went wrong. Do not leak the
      // absolute path beyond what's already part of the slug list.
      res.status(500).json({
        error: `failed to switch to ${path.basename(target.root)}: ${detail}`,
      });
    }
  });

  return router;
}
