import { describe, it, expect } from 'vitest';
import { renderPreview } from '../../src/review/renderPreview.js';
import type { PreviewResult } from '../../src/review/analyzeWorkingTree.js';

function makeResult(overrides: Partial<PreviewResult> = {}): PreviewResult {
  return {
    base: 'origin/main',
    headSha: 'abcdef1234567890',
    changedFiles: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0 },
    blastRadius: 0,
    topLevel: null,
    coupledNodes: [],
    isStub: false,
    ...overrides,
  };
}

describe('renderPreview', () => {
  it('renders an empty-changes message when topLevel is null', () => {
    const out = renderPreview(makeResult());
    expect(out).toContain('ctxloom preview');
    expect(out).toContain('No files changed vs `origin/main`');
  });

  it('renders the base ref and short head sha in the header', () => {
    const out = renderPreview(
      makeResult({
        changedFiles: [
          {
            file: 'src/foo.ts',
            riskLevel: 'low',
            importerCount: 0,
            isHub: false,
            hasTestCoverage: true,
          },
        ],
        summary: { critical: 0, high: 0, medium: 0, low: 1 },
        topLevel: 'low',
      }),
    );
    expect(out).toContain('origin/main');
    expect(out).toContain('abcdef1'); // 7-char short sha
  });

  it('renders a Risk breakdown only when there are above-low files', () => {
    const allLow = renderPreview(
      makeResult({
        changedFiles: [
          {
            file: 'src/foo.ts',
            riskLevel: 'low',
            importerCount: 0,
            isHub: false,
            hasTestCoverage: true,
          },
        ],
        summary: { critical: 0, high: 0, medium: 0, low: 1 },
        topLevel: 'low',
      }),
    );
    expect(allLow).not.toContain('Risk breakdown');

    const withHigh = renderPreview(
      makeResult({
        changedFiles: [
          {
            file: 'src/foo.ts',
            riskLevel: 'high',
            importerCount: 6,
            isHub: true,
            hasTestCoverage: false,
          },
        ],
        summary: { critical: 0, high: 1, medium: 0, low: 0 },
        topLevel: 'high',
      }),
    );
    expect(withHigh).toContain('Risk breakdown');
    expect(withHigh).toContain('src/foo.ts');
  });

  it('renders historical co-change pairs only when confidence >= 0.5', () => {
    const out = renderPreview(
      makeResult({
        changedFiles: [
          {
            file: 'src/auth.ts',
            riskLevel: 'medium',
            importerCount: 2,
            isHub: false,
            hasTestCoverage: false,
          },
        ],
        summary: { critical: 0, high: 0, medium: 1, low: 0 },
        topLevel: 'medium',
        coupledNodes: [
          { for: 'src/auth.ts', node: 'src/session.ts', confidence: 0.7 },
          { for: 'src/auth.ts', node: 'src/weak.ts', confidence: 0.3 }, // below threshold
        ],
      }),
    );
    expect(out).toContain('Historical co-change signals');
    expect(out).toContain('src/session.ts');
    expect(out).not.toContain('src/weak.ts');
  });

  it('renders an isStub warning when graph could not be built', () => {
    const out = renderPreview(
      makeResult({
        changedFiles: [
          {
            file: 'src/foo.ts',
            riskLevel: 'low',
            importerCount: 0,
            isHub: false,
            hasTestCoverage: false,
          },
        ],
        summary: { critical: 0, high: 0, medium: 0, low: 1 },
        topLevel: 'low',
        isStub: true,
      }),
    );
    expect(out).toContain('Graph not available');
  });
});
