/**
 * Parity tests for src/lib/analysis.ts
 *
 * Verifies that the pure library functions produce correct shapes and values
 * independent of any MCP formatting or server context.
 */
import { describe, it, expect } from 'vitest';
import { detectChanges, getImpactRadius } from '../src/lib/analysis.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { GitOverlayStore } from '../src/git/GitOverlayStore.js';
import type { GitCommitEvent } from '../src/git/GitHistoryMiner.js';

// ---------------------------------------------------------------------------
// Graph fixtures
// ---------------------------------------------------------------------------

function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  // hub: src/core.ts has 6 importers
  for (let i = 0; i < 6; i++) g.addEdge(`src/consumer${i}.ts`, 'src/core.ts');
  // covered: test imports src/util.ts
  g.addEdge('tests/util.test.ts', 'src/util.ts');
  // moderate: 2 importers, no test
  g.addEdge('src/a.ts', 'src/b.ts');
  g.addEdge('src/c.ts', 'src/b.ts');
  return g;
}

// ---------------------------------------------------------------------------
// Overlay fixture
// ---------------------------------------------------------------------------

function buildPopulatedOverlay(): GitOverlayStore {
  const store = new GitOverlayStore('/fake-repo');
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  const events: GitCommitEvent[] = [
    {
      sha: 'o1',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'fix: edge case in core',
      files: [
        { path: 'src/core.ts', added: 10, deleted: 5 },
        { path: 'src/partner.ts', added: 3, deleted: 1 },
      ],
      isMerge: false,
      isBulk: false,
    },
    {
      sha: 'o2',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'fix: another bug in core',
      files: [
        { path: 'src/core.ts', added: 8, deleted: 4 },
        { path: 'src/partner.ts', added: 2, deleted: 0 },
      ],
      isMerge: false,
      isBulk: false,
    },
    {
      sha: 'o3',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'feat: extend core',
      files: [
        { path: 'src/core.ts', added: 20, deleted: 0 },
        { path: 'src/partner.ts', added: 5, deleted: 2 },
      ],
      isMerge: false,
      isBulk: false,
    },
    {
      sha: 'o4',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'refactor: clean core',
      files: [
        { path: 'src/core.ts', added: 15, deleted: 10 },
        { path: 'src/partner.ts', added: 1, deleted: 0 },
      ],
      isMerge: false,
      isBulk: false,
    },
  ];

  for (const event of events) {
    store.coChange.ingest(event);
    store.churn.ingest(event);
    store.ownership.ingest(event);
  }

  return store;
}

// ---------------------------------------------------------------------------
// detectChanges
// ---------------------------------------------------------------------------

describe('detectChanges', () => {
  it('returns the expected result shape', () => {
    const graph = makeGraph();
    const result = detectChanges({ graph, changedFiles: ['src/core.ts'] });

    expect(result).toHaveProperty('changedFiles');
    expect(result).toHaveProperty('summary');
    expect(result.summary).toMatchObject({
      critical: expect.any(Number),
      high: expect.any(Number),
      medium: expect.any(Number),
      low: expect.any(Number),
    });
  });

  it('scores a hub file with no test coverage as critical', () => {
    const graph = makeGraph();
    const result = detectChanges({ graph, changedFiles: ['src/core.ts'] });

    expect(result.summary.critical).toBe(1);
    expect(result.changedFiles[0].riskLevel).toBe('critical');
  });

  it('scores a file with test coverage as low', () => {
    const graph = makeGraph();
    const result = detectChanges({ graph, changedFiles: ['src/util.ts'] });

    expect(result.changedFiles[0].riskLevel).toBe('low');
    expect(result.changedFiles[0].hasTestCoverage).toBe(true);
  });

  it('exposes importerCount and isHub on each changed file', () => {
    const graph = makeGraph();
    const result = detectChanges({ graph, changedFiles: ['src/core.ts'] });
    const file = result.changedFiles[0];

    expect(file.importerCount).toBe(6);
    expect(file.isHub).toBe(true);
  });

  it('risk is null when no overlay is provided', () => {
    const graph = makeGraph();
    const result = detectChanges({ graph, changedFiles: ['src/core.ts'] });

    expect(result.changedFiles[0].risk).toBeNull();
  });

  it('risk block is populated when overlay is provided', () => {
    const graph = makeGraph();
    const overlay = buildPopulatedOverlay();
    const result = detectChanges({ graph, overlay, changedFiles: ['src/core.ts'] });

    const risk = result.changedFiles[0].risk;
    expect(risk).not.toBeNull();
    expect(['low', 'medium', 'high']).toContain(risk!.churn);
    expect(typeof risk!.bugDensity).toBe('number');
    expect(Array.isArray(risk!.coupledNodes)).toBe(true);
    expect(Array.isArray(risk!.owners)).toBe(true);
  });

  it('coupledNodes includes src/partner.ts when sharedCommits >= 3', () => {
    const graph = makeGraph();
    const overlay = buildPopulatedOverlay();
    const result = detectChanges({ graph, overlay, changedFiles: ['src/core.ts'] });

    const nodes = result.changedFiles[0].risk?.coupledNodes ?? [];
    expect(nodes.some(n => n.node === 'src/partner.ts')).toBe(true);
  });

  it('owners list includes Alice', () => {
    const graph = makeGraph();
    const overlay = buildPopulatedOverlay();
    const result = detectChanges({ graph, overlay, changedFiles: ['src/core.ts'] });

    const owners = result.changedFiles[0].risk?.owners ?? [];
    expect(owners.some(o => o.author === 'Alice')).toBe(true);
  });

  it('sorts results by risk level (critical before low)', () => {
    const graph = makeGraph();
    const result = detectChanges({
      graph,
      changedFiles: ['src/util.ts', 'src/core.ts'],
    });

    const levels = result.changedFiles.map(f => f.riskLevel);
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < levels.length; i++) {
      expect(order[levels[i - 1]]).toBeLessThanOrEqual(order[levels[i]]);
    }
  });

  it('returns empty result for empty changedFiles', () => {
    const graph = makeGraph();
    const result = detectChanges({ graph, changedFiles: [] });
    expect(result.changedFiles).toHaveLength(0);
    expect(result.summary).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });
});

// ---------------------------------------------------------------------------
// getImpactRadius
// ---------------------------------------------------------------------------

describe('getImpactRadius', () => {
  it('returns the expected result shape', () => {
    const graph = makeGraph();
    const result = getImpactRadius({ graph, changedFiles: ['src/b.ts'] });

    expect(result).toHaveProperty('seedFiles');
    expect(result).toHaveProperty('directImporters');
    expect(result).toHaveProperty('transitiveImporters');
    expect(result).toHaveProperty('historicalCoupling');
    expect(result).toHaveProperty('totalImpacted');
  });

  it('identifies direct importers of src/b.ts', () => {
    const graph = makeGraph();
    const result = getImpactRadius({ graph, changedFiles: ['src/b.ts'] });

    expect(result.directImporters).toContain('src/a.ts');
    expect(result.directImporters).toContain('src/c.ts');
  });

  it('does not include the seed file in importers', () => {
    const graph = makeGraph();
    const result = getImpactRadius({ graph, changedFiles: ['src/b.ts'] });

    expect(result.directImporters).not.toContain('src/b.ts');
    expect(result.transitiveImporters).not.toContain('src/b.ts');
  });

  it('returns empty importers for an isolated file', () => {
    const graph = makeGraph();
    const result = getImpactRadius({ graph, changedFiles: ['isolated.ts'] });

    expect(result.directImporters).toHaveLength(0);
    expect(result.transitiveImporters).toHaveLength(0);
    expect(result.totalImpacted).toBe(0);
  });

  it('historicalCoupling is empty when no overlay is provided', () => {
    const graph = makeGraph();
    const result = getImpactRadius({ graph, changedFiles: ['src/core.ts'] });

    expect(result.historicalCoupling).toHaveLength(0);
  });

  it('historicalCoupling is populated when overlay is provided', () => {
    const graph = makeGraph();
    const overlay = buildPopulatedOverlay();
    const result = getImpactRadius({ graph, overlay, changedFiles: ['src/core.ts'] });

    // src/partner.ts co-changes strongly with src/core.ts but is not a static importer
    expect(result.historicalCoupling.length).toBeGreaterThan(0);
    const partnerEntry = result.historicalCoupling.find(h => h.node === 'src/partner.ts');
    expect(partnerEntry).toBeDefined();
    expect(typeof partnerEntry!.confidence).toBe('number');
    expect(partnerEntry!.evidence).toMatch(/commits/);
  });

  it('totalImpacted equals directImporters + transitiveImporters', () => {
    const graph = makeGraph();
    const result = getImpactRadius({ graph, changedFiles: ['src/core.ts'] });

    expect(result.totalImpacted).toBe(
      result.directImporters.length + result.transitiveImporters.length,
    );
  });
});
