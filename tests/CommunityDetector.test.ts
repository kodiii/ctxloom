import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { CommunityDetector, type Community } from '../src/graph/CommunityDetector.js';

function makeClusteredGraph(): DependencyGraph {
  const g = new DependencyGraph();
  // Cluster A: auth group — densely connected
  g.addEdge('src/auth/user.ts', 'src/auth/session.ts');
  g.addEdge('src/auth/user.ts', 'src/auth/token.ts');
  g.addEdge('src/auth/session.ts', 'src/auth/token.ts');
  // Cluster B: api group — densely connected
  g.addEdge('src/api/handler.ts', 'src/api/router.ts');
  g.addEdge('src/api/router.ts', 'src/api/middleware.ts');
  g.addEdge('src/api/handler.ts', 'src/api/middleware.ts');
  // Single cross-cluster edge (weak coupling)
  g.addEdge('src/api/handler.ts', 'src/auth/user.ts');
  return g;
}

describe('CommunityDetector', () => {
  it('returns an array of Community objects', () => {
    const detector = new CommunityDetector(makeClusteredGraph());
    const communities = detector.detect();
    expect(Array.isArray(communities)).toBe(true);
    expect(communities.length).toBeGreaterThan(0);
    for (const c of communities) {
      expect(typeof c.id).toBe('number');
      expect(typeof c.name).toBe('string');
      expect(Array.isArray(c.files)).toBe(true);
      expect(c.files.length).toBeGreaterThan(0);
    }
  });

  it('every file appears in exactly one community', () => {
    const graph = makeClusteredGraph();
    const detector = new CommunityDetector(graph);
    const communities = detector.detect();

    const allCommunityFiles = communities.flatMap(c => c.files);
    const unique = new Set(allCommunityFiles);

    // No duplicates
    expect(allCommunityFiles.length).toBe(unique.size);
    // All files covered
    for (const file of graph.allFiles()) {
      expect(unique.has(file)).toBe(true);
    }
  });

  it('names community by longest common directory prefix', () => {
    const g = new DependencyGraph();
    g.addEdge('src/auth/user.ts', 'src/auth/session.ts');
    g.addEdge('src/auth/user.ts', 'src/auth/token.ts');

    const detector = new CommunityDetector(g);
    const communities = detector.detect();

    const authComm = communities.find(c => c.files.includes('src/auth/user.ts'));
    expect(authComm).toBeDefined();
    // All files share src/auth prefix
    expect(authComm!.name).toContain('src/auth');
  });

  it('returns empty array for empty graph', () => {
    const detector = new CommunityDetector(new DependencyGraph());
    expect(detector.detect()).toEqual([]);
  });

  it('caches and returns stale=false when edge count unchanged', () => {
    const graph = makeClusteredGraph();
    const detector = new CommunityDetector(graph);
    const communities = detector.detect();

    // Serialise and restore via fromCache — edge count matches
    const payload = { edgeCount: graph.edgeCount(), communities };
    const restored = CommunityDetector.fromCache(payload, graph.edgeCount());
    expect(restored).not.toBeNull();
    expect(restored!.length).toBe(communities.length);
  });

  it('returns null from fromCache when edge count changed', () => {
    const graph = makeClusteredGraph();
    const detector = new CommunityDetector(graph);
    const communities = detector.detect();

    const payload = { edgeCount: 999, communities }; // wrong edge count
    expect(CommunityDetector.fromCache(payload, graph.edgeCount())).toBeNull();
  });
});
