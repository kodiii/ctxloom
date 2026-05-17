import { describe, it, expect } from 'vitest';
import { renderSummary, buildDeepReviewPrompt } from '../src/review/renderSummary.js';
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
  it('hides the (score: N%) parenthetical in the HEADER for low-risk PRs', () => {
    const payload = makePayload({ riskScore: 0.2, riskLabel: 'low' });
    const output = renderSummary(payload);
    // Scoped to the bot's own header (the first **Low risk** occurrence
    // before the deep-review prompt section, which legitimately restates
    // the band + score on every PR so the local Claude session has it).
    const header = output.split('<details>')[0];
    expect(header).toContain('Low risk');
    expect(header).not.toMatch(/Low risk[^\n]*\(score:/);
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
    // The cosmetic guard is specifically against the "Risk breakdown"
    // <details> with an empty body. The deep-review-prompt <details>
    // (added in the auto-prompt feature) is always emitted because
    // even low-risk PRs may warrant a second opinion. Both are
    // distinct sections; assert against the specific summary text.
    const payload = makePayload();  // default fixture is all low
    const output = renderSummary(payload);
    expect(output).not.toContain('Risk breakdown');
    expect(output).not.toContain('<summary>Risk breakdown</summary>');
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

/**
 * Deep-review prompt — the self-service auto-prompt feature that lets
 * a local Claude Code session pick up where the bot left off without
 * re-doing the bot's structural pre-fetch.
 *
 * Design contract pinned here:
 *   - prompt encodes pr number + repo + headSha (so the local session
 *     can fetch the diff without ambiguity)
 *   - prompt restates the bot's risk band + score (so the specialists
 *     don't run their own risk pass)
 *   - prompt lists top-risk files with coverage status (so the testing
 *     specialist starts where it matters most)
 *   - prompt explicitly demands PARALLEL dispatch + a single
 *     consolidated comment (without these, sessions either go serial
 *     or fan out noisily)
 *   - section wraps inside <details>, body inside a code fence (so the
 *     user can copy-paste it cleanly into Claude Code)
 */
describe('buildDeepReviewPrompt + auto-prompt section', () => {
  it('renderSummary embeds the deep-review section on every PR (including low risk)', () => {
    // Even low-risk PRs get the section — the bot doesn't know whether
    // the human wants a second opinion. Cheap to emit; hidden behind
    // <details> so it doesn't dominate.
    const output = renderSummary(makePayload());
    expect(output).toContain('<summary>🤖 Run a deep specialist review');
    expect(output).toContain('```\n');
  });

  it('prompt encodes the PR identity so the local session can fetch the diff', () => {
    const prompt = buildDeepReviewPrompt(makePayload());
    expect(prompt).toContain('PR #42');
    expect(prompt).toContain('acme/api');
    expect(prompt).toContain(BASE_PR.headSha);
  });

  it('prompt restates the bot-computed risk band + score so specialists skip the risk pass', () => {
    const prompt = buildDeepReviewPrompt(makePayload({ riskScore: 0.8, riskLabel: 'high' }));
    expect(prompt).toContain('🔴');
    expect(prompt).toContain('High risk');
    expect(prompt).toContain('80%');
  });

  it('prompt lists top-risk files with coverage status (✅ / ❌)', () => {
    const prompt = buildDeepReviewPrompt(
      makePayload({
        riskScore: 0.8,
        riskLabel: 'high',
        changedFiles: [
          { file: 'src/risky-no-cov.ts', riskLevel: 'high', importerCount: 6, isHub: true, hasTestCoverage: false, risk: null },
          { file: 'src/risky-with-cov.ts', riskLevel: 'medium', importerCount: 3, isHub: false, hasTestCoverage: true, risk: null },
          { file: 'src/safe.ts', riskLevel: 'low', importerCount: 0, isHub: false, hasTestCoverage: true, risk: null },
        ],
      }),
    );
    expect(prompt).toContain('src/risky-no-cov.ts');
    expect(prompt).toContain('❌ NO test coverage');
    expect(prompt).toContain('src/risky-with-cov.ts');
    expect(prompt).toContain('✅ test coverage');
    // Low-risk files filtered out — specialists shouldn't waste budget on them.
    expect(prompt).not.toContain('src/safe.ts');
  });

  it('prompt explicitly demands parallel dispatch + consolidated comment (anti-serialization guard)', () => {
    const prompt = buildDeepReviewPrompt(makePayload());
    expect(prompt).toMatch(/PARALLEL/);
    expect(prompt).toMatch(/single consolidated review comment/i);
  });

  it('prompt names all 4 specialists so the dispatcher knows the cohort', () => {
    const prompt = buildDeepReviewPrompt(makePayload());
    for (const s of ['security', 'architecture', 'testing', 'performance']) {
      expect(prompt).toContain(s);
    }
  });

  it('prompt threads suggested reviewers as judgment-call deferrals when present', () => {
    const prompt = buildDeepReviewPrompt(
      makePayload({
        suggestedReviewers: [
          { login: 'alice', rationale: 'top owner', share: 0.6 },
          { login: 'bob', rationale: 'recent approver' },
        ],
      }),
    );
    expect(prompt).toContain('@alice');
    expect(prompt).toContain('@bob');
    expect(prompt).toContain('defer judgment-call findings');
  });

  it('handles the empty-changed-files edge case without crashing or misrendering', () => {
    // PR with only renames or generated-file changes can produce an
    // empty changedFiles list at the bot layer. The prompt should
    // still emit, with a sensible "no above-low-risk files" hint
    // rather than an empty bullet list.
    const prompt = buildDeepReviewPrompt(
      makePayload({ changedFiles: [] }),
    );
    expect(prompt).toContain('no above-low-risk files');
  });

  it('the deep-review section is preserved under the CHAR_LIMIT fallback path', () => {
    // The renderSummary fallback that triggers when the comment exceeds
    // CHAR_LIMIT must still include the prompt — losing it on big PRs
    // would defeat the feature exactly when it's most useful.
    const bigChangedFiles = Array.from({ length: 200 }, (_, i) => ({
      file: `src/file-${i}.ts`,
      riskLevel: 'high' as const,
      importerCount: 5,
      isHub: false,
      hasTestCoverage: false,
      risk: null,
    }));
    const output = renderSummary(makePayload({
      riskScore: 0.9,
      riskLabel: 'high',
      changedFiles: bigChangedFiles,
    }));
    expect(output).toContain('🤖 Run a deep specialist review');
  });
});
