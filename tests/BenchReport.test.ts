import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../scripts/bench/report.js';
import type { BenchReport } from '../scripts/bench/types.js';

describe('renderMarkdown', () => {
  it('reports weighted corpus token totals separately from the mean ratio', () => {
    const report: BenchReport = {
      generatedAt: '2026-08-26T00:00:00.000Z',
      ctxloomSha: 'abc1234',
      stage: 'full',
      tokenEstimator: 'ceil(characters / 4)',
      overall: {
        repoCount: 0,
        prCount: 2,
        avgF1: 0.5,
        avgPrecision: 0.5,
        avgRecall: 0.5,
        avgSourceRecall: 0.5,
        avgGraphReachability: 0.5,
        avgSymbolCoverage: 1,
        avgImportCoverage: 1,
        totalNaiveTokens: 1_000,
        totalGraphTokens: 100,
        totalReduction: 10,
        avgReduction: 12.5,
      },
      repos: [],
    };

    const markdown = renderMarkdown(report);

    expect(markdown).toContain('| 1,000 | 100 | 900 (90.0%) | 10.0× | 12.5× |');
    expect(markdown).toContain('code-context payload only');
    expect(markdown).toContain('not this Codex task\'s private reasoning');
  });
});
