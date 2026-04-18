import path from 'node:path';
import { DependencyGraph } from '../../../src/graph/DependencyGraph.js';
import { GitOverlayStore } from '../../../src/git/GitOverlayStore.js';

export interface DashboardContext {
  root: string;
  graph: DependencyGraph;
  overlay: GitOverlayStore;
  gitEnabled: boolean;
  lastIndexed: Date;
}

export async function loadContext(root: string): Promise<DashboardContext> {
  const absRoot = path.resolve(root);

  const graph = new DependencyGraph();
  await graph.buildFromDirectory(absRoot);

  const overlay = new GitOverlayStore(absRoot);
  const gitEnabled = await overlay.loadSnapshot();

  return { root: absRoot, graph, overlay, gitEnabled, lastIndexed: new Date() };
}

export async function reloadContext(ctx: DashboardContext): Promise<void> {
  const fresh = await loadContext(ctx.root);
  ctx.graph = fresh.graph;
  ctx.overlay = fresh.overlay;
  ctx.gitEnabled = fresh.gitEnabled;
  ctx.lastIndexed = fresh.lastIndexed;
}
