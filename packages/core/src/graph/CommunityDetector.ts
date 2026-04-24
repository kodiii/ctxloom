/**
 * CommunityDetector — Louvain community detection on the import graph.
 *
 * Builds an undirected graphology graph from the public DependencyGraph API,
 * runs Louvain clustering, and names each community by the longest common
 * directory prefix of its member files.
 *
 * Cache format: { edgeCount: number, communities: Community[] }
 * Invalidated when the graph's edge count changes.
 */
import { UndirectedGraph } from 'graphology';
import louvainPkg from 'graphology-communities-louvain';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const louvain: (g: UndirectedGraph) => Record<string, number> = (louvainPkg as any).default ?? louvainPkg;
import path from 'node:path';
import type { DependencyGraph } from './DependencyGraph.js';

export interface Community {
  id: number;
  name: string;
  files: string[];
}

export interface CommunityCache {
  edgeCount: number;
  communities: Community[];
}

/**
 * Returns the longest common directory prefix for a list of file paths.
 * E.g. ['src/auth/user.ts', 'src/auth/session.ts'] → 'src/auth'
 */
function longestCommonPrefix(files: string[]): string {
  if (files.length === 0) return 'unknown';

  const parts = files[0].split('/');
  let prefix = parts.slice(0, -1); // directory parts only

  for (const file of files.slice(1)) {
    const fileParts = file.split('/').slice(0, -1);
    const len = Math.min(prefix.length, fileParts.length);
    let i = 0;
    while (i < len && prefix[i] === fileParts[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }

  return prefix.length > 0 ? prefix.join('/') : path.basename(files[0]);
}

export class CommunityDetector {
  constructor(private readonly graph: DependencyGraph) {}

  /**
   * Run Louvain detection and return communities.
   * Each file in allFiles() appears in exactly one community.
   */
  detect(): Community[] {
    const files = this.graph.allFiles();
    if (files.length === 0) return [];

    // Build undirected graphology graph from the import graph
    const g = new UndirectedGraph({ multi: false });

    for (const file of files) {
      if (!g.hasNode(file)) g.addNode(file);
    }

    for (const file of files) {
      for (const imported of this.graph.getImports(file)) {
        if (g.hasNode(imported) && !g.hasEdge(file, imported)) {
          g.addEdge(file, imported);
        }
      }
    }

    // Louvain returns { [nodeKey]: communityId }
    const assignment: Record<string, number> = louvain(g);

    // Group files by community id
    const communityMap = new Map<number, string[]>();
    for (const [file, commId] of Object.entries(assignment)) {
      const group = communityMap.get(commId) ?? [];
      group.push(file);
      communityMap.set(commId, group);
    }

    return Array.from(communityMap.entries()).map(([id, communityFiles]) => ({
      id,
      name: longestCommonPrefix(communityFiles),
      files: communityFiles,
    }));
  }

  /**
   * Return cached communities if edgeCount matches, otherwise null.
   * Used by tools to avoid re-running detection on every call.
   */
  static fromCache(payload: CommunityCache, currentEdgeCount: number): Community[] | null {
    if (payload.edgeCount !== currentEdgeCount) return null;
    return payload.communities;
  }
}
