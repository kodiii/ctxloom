/**
 * Unit tests for the pure rendering surface of PreviewStatusBar.
 *
 * The class itself wires a `vscode.StatusBarItem` plus a file-save
 * debounce, both of which would need the vscode test harness. The
 * pure-data input → text/tooltip/color output transform is what
 * actually matters for correctness, so it's exported separately and
 * tested here without vscode.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  // Tests in this file only touch the pure render function. The
  // PreviewStatusBar class would also load vscode, but we don't
  // import it here.
  StatusBarAlignment: { Right: 2 },
}));

import { renderPreviewStatusBar } from '../../src/review/PreviewStatusBar.js';
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

describe('renderPreviewStatusBar', () => {
  it('idle state shows just "ctxloom"', () => {
    const out = renderPreviewStatusBar({ state: 'idle' });
    expect(out.text).toBe('ctxloom');
    expect(out.colorId).toBeUndefined();
  });

  it('analyzing state shows the spinner codicon', () => {
    const out = renderPreviewStatusBar({ state: 'analyzing' });
    expect(out.text).toContain('$(sync~spin)');
    expect(out.tooltip).toContain('analyzing');
  });

  it('no-base state warns and links to the fix', () => {
    const out = renderPreviewStatusBar({ state: 'no-base' });
    expect(out.text).toContain('$(question)');
    expect(out.tooltip).toContain('no usable base ref');
    expect(out.colorId).toBe('statusBarItem.warningForeground');
  });

  it('no-changes state shows "clean" with the base ref in tooltip', () => {
    const out = renderPreviewStatusBar({ state: 'no-changes', base: 'origin/main' });
    expect(out.text).toBe('ctxloom: clean');
    expect(out.tooltip).toContain('origin/main');
  });

  it('has-result with low risk uses 🟢 and no color tint', () => {
    const result = makeResult({
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
    });
    const out = renderPreviewStatusBar({ state: 'has-result', result });
    expect(out.text).toBe('🟢 ctxloom: low');
    expect(out.colorId).toBeUndefined();
  });

  it('has-result with medium uses 🟠 and warning color', () => {
    const result = makeResult({
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
    });
    const out = renderPreviewStatusBar({ state: 'has-result', result });
    expect(out.text).toBe('🟠 ctxloom: medium');
    expect(out.colorId).toBe('statusBarItem.warningForeground');
  });

  it('has-result with high uses 🔴 and error color', () => {
    const result = makeResult({
      changedFiles: [
        {
          file: 'src/core.ts',
          riskLevel: 'high',
          importerCount: 6,
          isHub: true,
          hasTestCoverage: false,
        },
      ],
      summary: { critical: 0, high: 1, medium: 0, low: 0 },
      topLevel: 'high',
    });
    const out = renderPreviewStatusBar({ state: 'has-result', result });
    expect(out.text).toBe('🔴 ctxloom: high');
    expect(out.colorId).toBe('statusBarItem.errorForeground');
  });

  it('has-result with critical uses 🚨 and error color', () => {
    const result = makeResult({
      changedFiles: [
        {
          file: 'src/migrations/047.sql',
          riskLevel: 'critical',
          importerCount: 14,
          isHub: true,
          hasTestCoverage: false,
        },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
      topLevel: 'critical',
    });
    const out = renderPreviewStatusBar({ state: 'has-result', result });
    expect(out.text).toBe('🚨 ctxloom: critical');
    expect(out.colorId).toBe('statusBarItem.errorForeground');
  });

  it('has-result tooltip includes file count, base ref, and blast radius', () => {
    const result = makeResult({
      base: 'origin/release-3',
      changedFiles: [
        {
          file: 'src/a.ts',
          riskLevel: 'medium',
          importerCount: 2,
          isHub: false,
          hasTestCoverage: false,
        },
        {
          file: 'src/b.ts',
          riskLevel: 'low',
          importerCount: 0,
          isHub: false,
          hasTestCoverage: true,
        },
      ],
      summary: { critical: 0, high: 0, medium: 1, low: 1 },
      topLevel: 'medium',
      blastRadius: 4,
    });
    const out = renderPreviewStatusBar({ state: 'has-result', result });
    expect(out.tooltip).toContain('2 files changed');
    expect(out.tooltip).toContain('origin/release-3');
    expect(out.tooltip).toContain('blast radius 4');
  });

  it('has-result without a result object falls back to no-changes UX', () => {
    // Defensive: the caller misclassified state. The renderer should
    // not crash, just degrade to the safe "clean" output.
    const out = renderPreviewStatusBar({ state: 'has-result' });
    expect(out.text).toBe('ctxloom: clean');
  });

  it('error state shows the alert codicon and error color', () => {
    const out = renderPreviewStatusBar({ state: 'error' });
    expect(out.text).toContain('$(alert)');
    expect(out.colorId).toBe('statusBarItem.errorForeground');
  });
});
