/**
 * Tests for Phase 4c — pr-bot suggested-next-steps section. Pins:
 *
 *   - Every payload gets the /ctxloom-review-pr suggestion (always-on)
 *   - High/medium risk + concrete top file → /ctxloom-blast suggestion
 *   - Low risk → no /ctxloom-blast suggestion (avoid noise)
 *   - Multi-file + non-low risk → /ctxloom-coverage-gap suggestion
 *   - Large diff (≥10 files) → /ctxloom-explore suggestion
 *   - Top-risk file picked by importerCount descending (deterministic tiebreak)
 *   - Markdown section is well-formed + collapses behind <details>
 *   - Empty-step case returns empty string (caller omits section)
 *   - renderSummary integration: section appears between deepReview and footer
 */
import { describe, it, expect } from 'vitest';
import {
  computeSuggestedSteps,
  renderSuggestedStepsSection,
  isSafePathForMarkdown,
} from '../src/review/suggestedNextSteps.js';
import type { ReviewPayload } from '../src/review/types.js';
import { renderSummary } from '../src/review/renderSummary.js';
import type { ChangedFile } from '@ctxloom/core';

// ─── Test fixtures ───────────────────────────────────────────────────

function changedFile(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: 'src/foo.ts',
    bucket: 'core' as ChangedFile['bucket'],
    score: 0,
    risk: 'low',
    importerCount: 0,
    transitiveImpactedCount: 0,
    reason: '',
    breakdown: { churn: 0, codependency: 0, ownership: 0, ageProxy: 0, riskOverlay: 0 },
    ...overrides,
  };
}

function payload(overrides: Partial<ReviewPayload> = {}): ReviewPayload {
  return {
    pr: { owner: 'o', repo: 'r', number: 142, headSha: 'abc', baseSha: 'def' },
    riskScore: 0.5,
    riskLabel: 'medium',
    changedFiles: [changedFile({ path: 'src/foo.ts', importerCount: 10 })],
    impact: {
      totalImpacted: 25,
      directImporters: [],
      transitiveImpacted: [],
      hubChangedCount: 0,
      siloedChanges: [],
      acrossCommunityChanges: [],
    } as ReviewPayload['impact'],
    suggestedReviewers: [],
    config: {} as ReviewPayload['config'],
    ...overrides,
  };
}

// ─── always-on review-pr suggestion ──────────────────────────────────

describe('/ctxloom-review-pr always suggested', () => {
  it('low-risk PR still gets the review-pr suggestion', () => {
    const steps = computeSuggestedSteps(payload({ riskLabel: 'low', riskScore: 0.1 }));
    expect(steps[0].command).toBe('/ctxloom-review-pr 142');
    expect(steps[0].rationale).toMatch(/second opinion/i);
  });

  it('high-risk PR also gets review-pr (still first)', () => {
    const steps = computeSuggestedSteps(payload({ riskLabel: 'high', riskScore: 0.9 }));
    expect(steps[0].command).toBe('/ctxloom-review-pr 142');
  });
});

// ─── risk-tiered /ctxloom-blast ──────────────────────────────────────

describe('/ctxloom-blast suggestion', () => {
  it('high-risk + top file with importers → suggests blast', () => {
    const steps = computeSuggestedSteps(
      payload({
        riskLabel: 'high',
        changedFiles: [changedFile({ path: 'src/critical.ts', importerCount: 50 })],
      }),
    );
    expect(steps.some((s) => s.command === '/ctxloom-blast src/critical.ts')).toBe(true);
  });

  it('medium-risk + top file → suggests blast', () => {
    const steps = computeSuggestedSteps(
      payload({
        riskLabel: 'medium',
        changedFiles: [changedFile({ path: 'src/middleware.ts', importerCount: 10 })],
      }),
    );
    expect(steps.some((s) => s.command === '/ctxloom-blast src/middleware.ts')).toBe(true);
  });

  it('low-risk PR does NOT suggest blast (avoid noise)', () => {
    const steps = computeSuggestedSteps(
      payload({
        riskLabel: 'low',
        riskScore: 0.1,
        changedFiles: [changedFile({ path: 'docs/readme.md', importerCount: 10 })],
      }),
    );
    expect(steps.some((s) => s.command.startsWith('/ctxloom-blast'))).toBe(false);
  });

  it('no file with importers (orphan/leaf changes) → no blast suggestion', () => {
    const steps = computeSuggestedSteps(
      payload({
        riskLabel: 'high',
        changedFiles: [
          changedFile({ path: 'docs/a.md', importerCount: 0 }),
          changedFile({ path: 'docs/b.md', importerCount: 0 }),
        ],
      }),
    );
    expect(steps.some((s) => s.command.startsWith('/ctxloom-blast'))).toBe(false);
  });

  it('picks the file with the HIGHEST importerCount when multiple changed', () => {
    const steps = computeSuggestedSteps(
      payload({
        riskLabel: 'high',
        changedFiles: [
          changedFile({ path: 'src/low.ts', importerCount: 1 }),
          changedFile({ path: 'src/medium.ts', importerCount: 5 }),
          changedFile({ path: 'src/HIGH.ts', importerCount: 50 }),
        ],
      }),
    );
    expect(steps.some((s) => s.command === '/ctxloom-blast src/HIGH.ts')).toBe(true);
  });

  it('breaks ties by alphabetical path (deterministic)', () => {
    const steps = computeSuggestedSteps(
      payload({
        riskLabel: 'high',
        changedFiles: [
          changedFile({ path: 'src/z.ts', importerCount: 10 }),
          changedFile({ path: 'src/a.ts', importerCount: 10 }),
        ],
      }),
    );
    // Alphabetical first: src/a.ts
    expect(steps.some((s) => s.command === '/ctxloom-blast src/a.ts')).toBe(true);
  });
});

// ─── /ctxloom-coverage-gap ───────────────────────────────────────────

describe('/ctxloom-coverage-gap suggestion', () => {
  it('multi-file (≥3) + non-low risk → suggests coverage-gap', () => {
    const steps = computeSuggestedSteps(
      payload({
        riskLabel: 'medium',
        changedFiles: [
          changedFile({ path: 'a.ts' }),
          changedFile({ path: 'b.ts' }),
          changedFile({ path: 'c.ts' }),
        ],
      }),
    );
    expect(steps.some((s) => s.command === '/ctxloom-coverage-gap')).toBe(true);
  });

  it('1-file PR does NOT suggest coverage-gap (overkill)', () => {
    const steps = computeSuggestedSteps(
      payload({ changedFiles: [changedFile()] }),
    );
    expect(steps.some((s) => s.command === '/ctxloom-coverage-gap')).toBe(false);
  });

  it('low-risk multi-file PR does NOT suggest coverage-gap', () => {
    const steps = computeSuggestedSteps(
      payload({
        riskLabel: 'low',
        riskScore: 0.1,
        changedFiles: [
          changedFile({ path: 'a.ts' }),
          changedFile({ path: 'b.ts' }),
          changedFile({ path: 'c.ts' }),
        ],
      }),
    );
    expect(steps.some((s) => s.command === '/ctxloom-coverage-gap')).toBe(false);
  });
});

// ─── /ctxloom-explore ────────────────────────────────────────────────

describe('/ctxloom-explore suggestion (large diffs)', () => {
  it('≥10 files → suggests explore', () => {
    const big = Array.from({ length: 10 }, (_, i) =>
      changedFile({ path: `src/f${i}.ts` }),
    );
    const steps = computeSuggestedSteps(payload({ changedFiles: big }));
    expect(steps.some((s) => s.command === '/ctxloom-explore')).toBe(true);
  });

  it('9 files → no explore suggestion', () => {
    const medium = Array.from({ length: 9 }, (_, i) =>
      changedFile({ path: `src/f${i}.ts` }),
    );
    const steps = computeSuggestedSteps(payload({ changedFiles: medium }));
    expect(steps.some((s) => s.command === '/ctxloom-explore')).toBe(false);
  });
});

// ─── Markdown rendering ──────────────────────────────────────────────

describe('renderSuggestedStepsSection', () => {
  it('renders empty string for an empty list (caller omits section)', () => {
    expect(renderSuggestedStepsSection([])).toBe('');
  });

  it('wraps non-empty list in a collapsible <details> block', () => {
    const out = renderSuggestedStepsSection([
      { command: '/test-cmd', rationale: 'do the thing' },
    ]);
    expect(out).toContain('<details>');
    expect(out).toContain('</details>');
    expect(out).toContain('<summary>');
    expect(out).toContain('`/test-cmd`');
    expect(out).toContain('do the thing');
  });

  it('mentions ctxloom init as the install path', () => {
    const out = renderSuggestedStepsSection([
      { command: '/x', rationale: 'r' },
    ]);
    expect(out).toMatch(/ctxloom init/);
  });
});

// ─── renderSummary integration ───────────────────────────────────────

describe('renderSummary integration', () => {
  it('appends the suggested-steps section between the deep-review block and the footer', () => {
    const body = renderSummary(payload());
    // The section is a <details> block ABOVE the footer (which starts
    // with the bot signature line).
    const sectionIdx = body.indexOf('Suggested next steps');
    const footerIdx = body.indexOf('ctxloom pr-bot');
    expect(sectionIdx).toBeGreaterThan(0);
    expect(footerIdx).toBeGreaterThan(sectionIdx);
  });

  it('does NOT add the section header when computeSuggestedSteps returns an empty list', () => {
    // Edge case: future logic might return [] for some payloads.
    // For now, every payload returns at least the always-on review-pr
    // suggestion, so the section is always present. This test pins
    // the integration shape so a future "drop section when empty"
    // change can't accidentally leave a dangling header.
    const body = renderSummary(payload());
    expect(body).toContain('Suggested next steps');
  });
});

// ─── v1.5.0 dogfood M1 fix: filename injection safety ────────────────

describe('isSafePathForMarkdown (M1 from v1.5.0 dogfood)', () => {
  it.each([
    'src/foo.ts',
    'packages/core/src/budget/budget.ts',
    'apps/pr-bot/tests/suggestedNextSteps.test.ts',
    'docs/2026-05-18-agent-harness.md',
    'a/b/c-d_e+f.ts',
  ])('%j is safe', (p) => {
    expect(isSafePathForMarkdown(p)).toBe(true);
  });

  it.each([
    'src/`evil`.ts',                          // backtick — breaks inline code
    'src/<script>.ts',                        // HTML tag injection
    'src/foo\nbar.ts',                        // newline — breaks <details>
    'src/foo\rbar.ts',                        // carriage return
    'src/foo|bar.ts',                         // table cell escape
    'src/foo\\bar.ts',                        // backslash — Markdown escape
    'src/foo bar.ts',                         // whitespace (rejected for safety)
    '',                                       // empty
    'a'.repeat(501),                          // overlong
    '../../../etc/passwd',                    // path traversal — also rejected (good defense in depth)
    'src/</details>injection.md',             // details escape
  ])('%j is rejected', (p) => {
    expect(isSafePathForMarkdown(p)).toBe(false);
  });

  it('non-string inputs are rejected without throwing', () => {
    expect(isSafePathForMarkdown(null as unknown as string)).toBe(false);
    expect(isSafePathForMarkdown(undefined as unknown as string)).toBe(false);
    expect(isSafePathForMarkdown(42 as unknown as string)).toBe(false);
  });

  it('computeSuggestedSteps drops blast suggestion when top file fails the safety check', () => {
    // Construct a high-risk payload where the highest-importer file
    // has a hostile name. The blast suggestion should NOT fire.
    const steps = computeSuggestedSteps(
      payload({
        riskLabel: 'high',
        changedFiles: [
          changedFile({ path: 'src/<malicious>.ts', importerCount: 100 }),
          changedFile({ path: 'src/safe.ts', importerCount: 1 }),
        ],
      }),
    );
    // No blast suggestion (top file rejected by safety check, and we
    // don't fall back to the next-best file — leaving it out is the
    // safe default).
    expect(steps.some((s) => s.command.startsWith('/ctxloom-blast'))).toBe(false);
  });

  it('renderSuggestedStepsSection only contains its OWN wrapping </details>, no injected HTML', () => {
    // Belt-and-suspenders: the section legitimately wraps itself in
    // <details>...</details>. A safe input must NOT introduce
    // additional `</details>` (which would prematurely close the
    // block) or any `<script` tags or triple-backtick code fences.
    const body = renderSuggestedStepsSection([
      { command: '/ctxloom-blast safe-path.ts', rationale: 'r' },
    ]);
    expect(body).toContain('safe-path.ts');
    // Exactly one closing details tag (the section's own).
    expect((body.match(/<\/details>/g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/<script/);
    expect(body).not.toMatch(/```/);
  });
});
