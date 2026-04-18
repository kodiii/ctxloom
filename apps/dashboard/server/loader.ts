import path from 'node:path';
import { DependencyGraph } from '../../../src/graph/DependencyGraph.js';
import { GitOverlayStore } from '../../../src/git/GitOverlayStore.js';

export interface DashboardContext {
  root: string;
  graph: DependencyGraph;
  overlay: GitOverlayStore;
  gitEnabled: boolean;
}

export async function loadContext(root: string): Promise<DashboardContext> {
  const absRoot = path.resolve(root);

  const graph = new DependencyGraph();
  await graph.buildFromDirectory(absRoot);

  const overlay = new GitOverlayStore(absRoot);
  const gitEnabled = await overlay.loadSnapshot();

  return { root: absRoot, graph, overlay, gitEnabled };
}
