/**
 * Parity tests for src/lib/analysis.ts
 *
 * Verifies that the pure library functions produce correct shapes and values
 * independent of any MCP formatting or server context.
 */
import { describe, it, expect } from 'vitest';
import { detectChanges, getImpactRadius, DependencyGraph, GitOverlayStore } from '@ctxloom/core';
import type { GitCommitEvent } from '@ctxloom/core';

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

  it('scores non-source files (README.md) as low regardless of test coverage', () => {
    // Regression: pre-fix the scorer treated "no test coverage" as a
    // risk signal for every file, including README.md — bumping a
    // doc-only PR to `medium`. Non-source files can't have tests
    // and should never be penalized for the absence.
    const graph = makeGraph();
    const result = detectChanges({ graph, changedFiles: ['apps/pr-bot/README.md'] });
    expect(result.changedFiles[0].riskLevel).toBe('low');
  });

  it('treats CHANGELOG, LICENSE, and lockfiles as low risk', () => {
    const graph = makeGraph();
    const files = ['CHANGELOG.md', 'LICENSE', 'package-lock.json', 'src/icon.svg'];
    const result = detectChanges({ graph, changedFiles: files });
    for (const f of result.changedFiles) {
      expect(f.riskLevel, `${f.file} should be low`).toBe('low');
    }
  });

  it('does NOT down-rank a hub non-source file (escalates to high)', () => {
    // A CHANGELOG.md with 5+ importers (e.g. a shared file referenced
    // by other docs) is unusual but a real signal worth flagging.
    const graph = new DependencyGraph();
    for (let i = 0; i < 6; i++) graph.addEdge(`docs/page${i}.md`, 'docs/CHANGELOG.md');
    const result = detectChanges({ graph, changedFiles: ['docs/CHANGELOG.md'] });
    expect(result.changedFiles[0].riskLevel).toBe('high');
    expect(result.changedFiles[0].isHub).toBe(true);
  });

  it('still down-ranks source files (.json configs are NOT non-source)', () => {
    // package.json / tsconfig.json affect runtime — they should stay
    // on the normal risk track, not get the doc-file pass.
    const graph = new DependencyGraph();
    const result = detectChanges({ graph, changedFiles: ['package.json'] });
    // No importers, no coverage, source-file track → medium.
    expect(result.changedFiles[0].riskLevel).toBe('medium');
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

  // ─── New v1.6.0 prediction signals ──────────────────────────────────

  it('directImportees is empty by default (legacy behavior preserved)', () => {
    const graph = makeGraph();
    const result = getImpactRadius({ graph, changedFiles: ['src/b.ts'] });

    expect(result.directImportees).toEqual([]);
  });

  it('symbolCallers is empty by default (legacy behavior preserved)', () => {
    const graph = makeGraph();
    const result = getImpactRadius({ graph, changedFiles: ['src/b.ts'] });

    expect(result.symbolCallers).toEqual([]);
  });

  it('directImportees lists files the seed depends on when includeImportees=true', () => {
    const graph = new DependencyGraph();
    // seed = src/main.ts; main → util1.ts, util2.ts
    graph.addEdge('src/main.ts', 'src/util1.ts');
    graph.addEdge('src/main.ts', 'src/util2.ts');
    // Add an importer so we can still verify inbound arm is unaffected
    graph.addEdge('src/caller.ts', 'src/main.ts');

    const result = getImpactRadius({
      graph,
      changedFiles: ['src/main.ts'],
      includeImportees: true,
    });

    expect(result.directImportees).toContain('src/util1.ts');
    expect(result.directImportees).toContain('src/util2.ts');
    expect(result.directImporters).toContain('src/caller.ts');
    expect(result.directImportees).not.toContain('src/main.ts');
  });

  it('directImportees excludes seed files themselves', () => {
    const graph = new DependencyGraph();
    // Two seed files that import each other (cycle)
    graph.addEdge('src/a.ts', 'src/b.ts');
    graph.addEdge('src/b.ts', 'src/a.ts');
    graph.addEdge('src/a.ts', 'src/util.ts');

    const result = getImpactRadius({
      graph,
      changedFiles: ['src/a.ts', 'src/b.ts'],
      includeImportees: true,
    });

    expect(result.directImportees).toContain('src/util.ts');
    expect(result.directImportees).not.toContain('src/a.ts');
    expect(result.directImportees).not.toContain('src/b.ts');
  });

  it('totalImpacted accumulates all four signals', () => {
    const graph = new DependencyGraph();
    graph.addEdge('src/main.ts', 'src/util.ts');     // importee
    graph.addEdge('src/caller.ts', 'src/main.ts');   // importer

    const baseline = getImpactRadius({ graph, changedFiles: ['src/main.ts'] });
    expect(baseline.totalImpacted).toBe(1); // just src/caller.ts

    const augmented = getImpactRadius({
      graph,
      changedFiles: ['src/main.ts'],
      includeImportees: true,
    });
    expect(augmented.totalImpacted).toBe(2); // + src/util.ts
  });

  it('symbolCallers keeps specific-method callers and drops generic-method-only callers', () => {
    // Validates the specificity-weighted ranking + min-score floor
    // from v1.6.0. Callers of UNIQUELY-defined symbols (specificity
    // = 1.0) pass the floor. Callers of multi-defined symbols
    // (specificity < 1.0) are dropped unless they also call other
    // signals.
    const graph = new DependencyGraph();
    graph.addSymbol('src/seed.ts', {
      name: 'unique',
      type: 'function',
      signature: 'function unique()',
      startLine: 1,
      endLine: 1,
    });
    graph.addSymbol('src/seed.ts', {
      name: 'common',
      type: 'function',
      signature: 'function common()',
      startLine: 2,
      endLine: 2,
    });
    for (let i = 0; i < 4; i++) {
      graph.addSymbol(`src/other-${i}.ts`, {
        name: 'common',
        type: 'function',
        signature: 'function common()',
        startLine: 1,
        endLine: 1,
      });
    }
    const cg = graph.getCallGraphIndex();
    cg.addEdge({
      callerFile: 'src/caller-unique.ts',
      callerSymbol: '',
      calleeSymbol: 'unique',
      confidence: 'extracted',
    });
    cg.addEdge({
      callerFile: 'src/caller-common.ts',
      callerSymbol: '',
      calleeSymbol: 'common',
      confidence: 'extracted',
    });

    const result = getImpactRadius({
      graph,
      changedFiles: ['src/seed.ts'],
      includeSymbolCallers: true,
    });

    // Unique-caller scores 1.0 (specificity = 1/1) → passes floor.
    expect(result.symbolCallers).toContain('src/caller-unique.ts');
    // Common-caller scores 0.2 (specificity = 1/5) → dropped by floor.
    expect(result.symbolCallers).not.toContain('src/caller-common.ts');
  });

  it('symbolCallers path-proximity bonus rescues low-specificity callers', () => {
    // Path-proximity bonus: a caller whose path contains the seed's
    // basename or 3-char prefix gets +1.0. This rescues callers that
    // would otherwise fall under the min-score floor — common for
    // test files calling a single low-specificity symbol of a hub.
    const graph = new DependencyGraph();
    // 'send' is defined in 5 places → specificity = 0.2.
    graph.addSymbol('lib/response.js', {
      name: 'send',
      type: 'function',
      signature: 'function send()',
      startLine: 1,
      endLine: 1,
    });
    for (let i = 0; i < 4; i++) {
      graph.addSymbol(`other-${i}.js`, {
        name: 'send',
        type: 'function',
        signature: 'function send()',
        startLine: 1,
        endLine: 1,
      });
    }
    const cg = graph.getCallGraphIndex();
    cg.addEdge({
      callerFile: 'test/res.send.js',
      callerSymbol: '',
      calleeSymbol: 'send',
      confidence: 'extracted',
    });
    cg.addEdge({
      callerFile: 'benchmarks/middleware.js',
      callerSymbol: '',
      calleeSymbol: 'send',
      confidence: 'extracted',
    });

    const result = getImpactRadius({
      graph,
      changedFiles: ['lib/response.js'],
      includeSymbolCallers: true,
    });

    // test/res.send.js: 0.2 (specificity) + 1.0 (path match "res") = 1.2 → passes floor.
    expect(result.symbolCallers).toContain('test/res.send.js');
    // benchmarks/middleware.js: 0.2 (specificity), no proximity → 0.2 → dropped.
    expect(result.symbolCallers).not.toContain('benchmarks/middleware.js');
  });

  it('symbolCallers caps the result at the top-K ranked callers', () => {
    // Verifies the ranking truncation — without it, a hub file with
    // 100+ callers of a generic method would dump all callers into the
    // prediction and crash precision.
    const graph = new DependencyGraph();
    // Register many files in the graph by adding any edge that
    // references them. They don't import the seed.
    for (let i = 0; i < 50; i++) {
      graph.addEdge(`src/caller${i}.ts`, 'src/somewhere-else.ts');
    }
    // Manually wire each caller to call 'doStuff', defined in seed.
    graph.addSymbol('src/seed.ts', {
      name: 'doStuff',
      type: 'function',
      signature: 'function doStuff()',
      startLine: 1,
      endLine: 3,
    });
    const callGraph = graph.getCallGraphIndex();
    for (let i = 0; i < 50; i++) {
      callGraph.addEdge({
        callerFile: `src/caller${i}.ts`,
        callerSymbol: '',
        calleeSymbol: 'doStuff',
        confidence: 'extracted',
      });
    }

    const result = getImpactRadius({
      graph,
      changedFiles: ['src/seed.ts'],
      includeSymbolCallers: true,
    });

    // Top-K cap is 25 by current calibration.
    expect(result.symbolCallers.length).toBeLessThanOrEqual(25);
  });
});
