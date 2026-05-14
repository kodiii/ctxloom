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

  // Cosmetic regression: PR #94 (a docs-only change) rendered with
  // "Low risk (score: 20%)" — the score parenthetical felt arbitrary
  // for a band that's already self-explanatory. Hide for `low`, keep
  // for medium/high/critical where the magnitude matters.
  it('hides the (score: N%) parenthetical for low-risk PRs', () => {
    const payload = makePayload({ riskScore: 0.2, riskLabel: 'low' });
    const output = renderSummary(payload);
    expect(output).toContain('Low risk');
    expect(output).not.toMatch(/Low risk[^\n]*\(score:/);
  });

  it('still shows (score: N%) for medium/high/critical', () => {
    for (const [score, label] of [
      [0.5, 'medium'] as const,
      [0.8, 'high'] as const,
      [1.0, 'critical'] as const,
    ]) {
      const payload = makePayload({ riskScore: score, riskLabel: label });
      expect(renderSummary(payload)).toContain('(score:');
    }
  });

  // Cosmetic regression: PR #94 (all-low changes) rendered a Risk
  // breakdown <details> block whose body was just the markdown
  // headers with no rows. Skip the block entirely when there's
  // nothing above `low` to report.
  it('omits the Risk breakdown <details> when all files are low', () => {
    const payload = makePayload();  // default fixture is all low
    const output = renderSummary(payload);
    expect(output).not.toContain('Risk breakdown');
    expect(output).not.toContain('<details>');
  });

  it('still includes the Risk breakdown when at least one file is above low', () => {
    const payload = makePayload({
      riskScore: 0.8,
      riskLabel: 'high',
      changedFiles: [
        {
          file: 'src/auth.ts',
          riskLevel: 'high',
          importerCount: 8,
          isHub: true,
          hasTestCoverage: false,
          risk: null,
        },
      ],
    });
    const output = renderSummary(payload);
    expect(output).toContain('Risk breakdown');
    expect(output).toContain('src/auth.ts');
  });
});
