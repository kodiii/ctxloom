import { describe, it, expect } from 'vitest';
import { buildReview } from '../src/review/buildReview.js';
import { riskLabelFromScore } from '../src/review/types.js';
import { DependencyGraph } from '../../../src/graph/DependencyGraph.js';
import { DEFAULT_CONFIG } from '../src/config.js';

function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  // node-a.ts has 3 importers
  g.addEdge('src/importer1.ts', 'src/node-a.ts');
  g.addEdge('src/importer2.ts', 'src/node-a.ts');
  g.addEdge('src/importer3.ts', 'src/node-a.ts');
  // node-b.ts has 1 importer and test coverage
  g.addEdge('tests/node-b.test.ts', 'src/node-b.ts');
  // node-c.ts has no importers and no test
  return g;
}

const PR = {
  owner: 'acme',
  repo: 'api',
  number: 42,
  headSha: 'head-sha',
  baseSha: 'base-sha',
};

describe('buildReview', () => {
  it('riskScore is the max of individual file scores', async () => {
    const graph = makeGraph();
    // node-a.ts is 'high' risk (3 importers, no coverage) => score 0.8
    // node-b.ts has coverage => 'low' => score 0.2
    const result = await buildReview({
      graph,
      overlay: undefined,
      changedFiles: ['src/node-a.ts', 'src/node-b.ts'],
      pr: PR,
      config: DEFAULT_CONFIG,
    });

    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskScore).toBeLessThanOrEqual(1);
    // max should be from node-a.ts (high risk = 0.8)
    expect(result.riskScore).toBe(0.8);
  });

  it('riskLabel matches riskLabelFromScore(riskScore)', async () => {
    const graph = makeGraph();
    const result = await buildReview({
      graph,
      overlay: undefined,
      changedFiles: ['src/node-a.ts'],
      pr: PR,
      config: DEFAULT_CONFIG,
    });

    expect(result.riskLabel).toBe(riskLabelFromScore(result.riskScore));
  });

  it('impact.totalImpacted >= 0', async () => {
    const graph = makeGraph();
    const result = await buildReview({
      graph,
      overlay: undefined,
      changedFiles: ['src/node-a.ts', 'src/node-c.ts'],
      pr: PR,
      config: DEFAULT_CONFIG,
    });

    expect(result.impact.totalImpacted).toBeGreaterThanOrEqual(0);
  });

  it('changedFiles.length matches the input list', async () => {
    const graph = makeGraph();
    const input = ['src/node-a.ts', 'src/node-b.ts', 'src/node-c.ts'];
    const result = await buildReview({
      graph,
      overlay: undefined,
      changedFiles: input,
      pr: PR,
      config: DEFAULT_CONFIG,
    });

    expect(result.changedFiles).toHaveLength(input.length);
  });

  it('riskScore is 0 when no files are changed', async () => {
    const graph = makeGraph();
    const result = await buildReview({
      graph,
      overlay: undefined,
      changedFiles: [],
      pr: PR,
      config: DEFAULT_CONFIG,
    });

    expect(result.riskScore).toBe(0);
    expect(result.riskLabel).toBe('low');
  });

  it('suggestedReviewers is empty (placeholder for Task 8)', async () => {
    const graph = makeGraph();
    const result = await buildReview({
      graph,
      overlay: undefined,
      changedFiles: ['src/node-a.ts'],
      pr: PR,
      config: DEFAULT_CONFIG,
    });

    expect(result.suggestedReviewers).toEqual([]);
  });
});
