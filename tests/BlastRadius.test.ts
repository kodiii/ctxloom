import { describe, it, expect } from 'vitest';
import { computeBlastRadius, type BlastRadiusOptions } from '../src/tools/blast-radius.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';

function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  // auth.ts ← services/user.ts ← controllers/api.ts ← server.ts
  g.addEdge('services/user.ts', 'auth.ts');
  g.addEdge('controllers/api.ts', 'services/user.ts');
  g.addEdge('server.ts', 'controllers/api.ts');
  return g;
}

describe('computeBlastRadius', () => {
  it('identifies direct importers', async () => {
    const graph = makeGraph();
    const result = await computeBlastRadius({
      changedFiles: ['auth.ts'],
      depth: 1,
      projectRoot: '/fake',
      graph,
    });
    expect(result.directImporters).toContain('services/user.ts');
    expect(result.directImporters).not.toContain('controllers/api.ts');
  });

  it('identifies transitive importers at depth 3', async () => {
    const graph = makeGraph();
    const result = await computeBlastRadius({
      changedFiles: ['auth.ts'],
      depth: 3,
      projectRoot: '/fake',
      graph,
    });
    expect(result.transitiveImporters).toContain('controllers/api.ts');
    expect(result.transitiveImporters).toContain('server.ts');
  });

  it('excludes changed files from importer lists', async () => {
    const graph = makeGraph();
    const result = await computeBlastRadius({
      changedFiles: ['auth.ts'],
      depth: 3,
      projectRoot: '/fake',
      graph,
    });
    expect(result.directImporters).not.toContain('auth.ts');
    expect(result.transitiveImporters).not.toContain('auth.ts');
  });

  it('returns empty results for isolated file', async () => {
    const graph = makeGraph();
    const result = await computeBlastRadius({
      changedFiles: ['isolated.ts'],
      depth: 3,
      projectRoot: '/fake',
      graph,
    });
    expect(result.directImporters).toHaveLength(0);
    expect(result.transitiveImporters).toHaveLength(0);
  });
});
