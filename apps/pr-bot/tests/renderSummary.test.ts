import { describe, it, expect } from 'vitest';
import { renderSummary } from '../src/review/renderSummary.js';
import { buildCommentBody } from '../src/review/idempotency.js';
import type { ReviewPayload } from '../src/review/types.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const BASE_PR = {
  owner: 'acme',
  repo: 'api',
  number: 42,
  headSha: 'abc123def456',
  baseSha: 'base000',
};

function makePayload(overrides: Partial<ReviewPayload> = {}): ReviewPayload {
  return {
    pr: BASE_PR,
    riskScore: 0.2,
    riskLabel: 'low',
    changedFiles: [
      {
        file: 'src/foo.ts',
        riskLevel: 'low',
        importerCount: 1,
        isHub: false,
        hasTestCoverage: true,
        risk: null,
      },
    ],
    impact: {
      seedFiles: ['src/foo.ts'],
      directImporters: [],
      transitiveImporters: [],
      historicalCoupling: [],
      totalImpacted: 0,
    },
    suggestedReviewers: [],
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

describe('renderSummary', () => {
  it('contains the HTML marker with headSha', () => {
    const payload = makePayload();
    const output = renderSummary(payload);
    expect(output).toContain(`<!-- ctxloom:review:${BASE_PR.headSha} -->`);
  });

  it('contains 🟢 for low risk', () => {
    const payload = makePayload({ riskScore: 0.2, riskLabel: 'low' });
    const output = renderSummary(payload);
    expect(output).toContain('🟢');
  });

  it('contains 🟠 for medium risk', () => {
    const payload = makePayload({ riskScore: 0.5, riskLabel: 'medium' });
    const output = renderSummary(payload);
    expect(output).toContain('🟠');
  });

  it('contains 🔴 for high risk', () => {
    const payload = makePayload({ riskScore: 0.8, riskLabel: 'high' });
    const output = renderSummary(payload);
    expect(output).toContain('🔴');
  });

  it('is under 65000 characters even with 200 changed files', () => {
    const manyFiles = Array.from({ length: 200 }, (_, i) => ({
      file: `src/component-${i}.ts`,
      riskLevel: 'high' as const,
      importerCount: 10,
      isHub: true,
      hasTestCoverage: false,
      risk: {
        churn: 'high' as const,
        bugDensity: 0.9,
        coupledNodes: [{ node: `src/sibling-${i}.ts`, confidence: 0.8 }],
        owners: [{ author: 'alice', share: 0.6 }],
      },
    }));
    const payload = makePayload({
      changedFiles: manyFiles,
      riskScore: 0.8,
      riskLabel: 'high',
    });
    const output = renderSummary(payload);
    expect(output.length).toBeLessThan(65000);
  });

  it('contains "Affected flows" section when totalImpacted > 0', () => {
    const payload = makePayload({
      impact: {
        seedFiles: ['src/foo.ts'],
        directImporters: ['src/bar.ts'],
        transitiveImporters: ['src/baz.ts'],
        historicalCoupling: [],
        totalImpacted: 2,
      },
    });
    const output = renderSummary(payload);
    expect(output).toContain('Affected flows');
  });

  it('does not contain "Affected flows" when totalImpacted is 0', () => {
    const payload = makePayload();
    const output = renderSummary(payload);
    expect(output).not.toContain('Affected flows');
  });

  it('footer no longer advertises Probot-era slash commands', () => {
    // The pre-Action footer suggested /ctxloom explain|ignore|refresh.
    // Those were issue_comment handlers (Probot-only) and were deleted
    // when pr-bot pivoted to a fire-and-forget GitHub Action. The
    // footer must not promise capabilities that no longer exist.
    const payload = makePayload();
    const output = renderSummary(payload);
    expect(output).not.toContain('/ctxloom explain');
    expect(output).not.toContain('/ctxloom ignore');
    expect(output).not.toContain('/ctxloom refresh');
  });

  it('footer links to the README and the issue-filing form', () => {
    const payload = makePayload();
    const output = renderSummary(payload);
    expect(output).toContain('apps/pr-bot/README.md');
    expect(output).toContain('issues/new?labels=pr-bot');
  });
});
