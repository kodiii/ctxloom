import path from 'node:path';
import { DependencyGraph, GitOverlayStore, recordTrendSnapshot } from '@ctxloom/core';

export interface DashboardContext {
  root: string;
  graph: DependencyGraph;
  overlay: GitOverlayStore;
  gitEnabled: boolean;
  lastIndexed: Date;
}

export async function loadContext(root: string): Promise<DashboardContext> {
  const absRoot = path.resolve(root);

  const overlay = new GitOverlayStore(absRoot);
  const gitEnabled = await overlay.loadSnapshot();

  const graph = new DependencyGraph();
  await graph.buildFromDirectory(absRoot, {
    afterReady: async () => {
      await recordTrendSnapshot({
        graph,
        overlay,
        gitEnabled,
        rootDir: absRoot,
        source: 'dashboard',
      });
    },
  });

  return { root: absRoot, graph, overlay, gitEnabled, lastIndexed: new Date() };
}

export async function reloadContext(ctx: DashboardContext): Promise<void> {
  const fresh = await loadContext(ctx.root);
  ctx.graph = fresh.graph;
  ctx.overlay = fresh.overlay;
  ctx.gitEnabled = fresh.gitEnabled;
  ctx.lastIndexed = fresh.lastIndexed;
}

/**
 * Mutate `ctx` in place to point at a different project root.
 *
 * All Express routers capture the original `ctx` by reference, so we
 * keep its object identity stable and just swap the fields. This lets
 * the multi-project switcher hot-swap without rebuilding the router
 * tree (which Express doesn't support cleanly).
 */
export async function switchContext(ctx: DashboardContext, newRoot: string): Promise<void> {
  const fresh = await loadContext(newRoot);
  ctx.root = fresh.root;
  ctx.graph = fresh.graph;
  ctx.overlay = fresh.overlay;
  ctx.gitEnabled = fresh.gitEnabled;
  ctx.lastIndexed = fresh.lastIndexed;
}
