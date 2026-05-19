/**
 * Unit tests for the F1/precision/recall calculations the public
 * benchmark numbers rest on. Pure functions, no I/O, no graph
 * dependencies — easy to test exhaustively, and critical to get
 * right because we'll be publishing these numbers in a setting
 * where reviewers will check them.
 */
import { describe, it, expect } from 'vitest';
import { computeMetrics, avg } from '../scripts/bench/metrics.js';

describe('computeMetrics', () => {
  it('perfect prediction → F1 1.0', () => {
    const m = computeMetrics(1, ['a.ts', 'b.ts', 'c.ts'], ['a.ts', 'b.ts', 'c.ts']);
    expect(m.truePositives).toBe(3);
    expect(m.falsePositives).toBe(0);
    expect(m.falseNegatives).toBe(0);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
  });

  it('no prediction overlap with ground truth → F1 0', () => {
    const m = computeMetrics(1, ['a.ts', 'b.ts'], ['c.ts', 'd.ts']);
    expect(m.truePositives).toBe(0);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });

  it('over-prediction (high recall, low precision) — characteristic of conservative blast radius', () => {
    // Graph predicts 5 files, only 2 are real → P=0.4, R=1.0, F1=0.57
    const m = computeMetrics(1, ['a.ts', 'b.ts'], ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']);
    expect(m.truePositives).toBe(2);
    expect(m.falsePositives).toBe(3);
    expect(m.falseNegatives).toBe(0);
    expect(m.precision).toBeCloseTo(0.4);
    expect(m.recall).toBe(1);
    expect(m.f1).toBeCloseTo(0.5714, 3);
  });

  it('under-prediction (high precision, low recall) — the dangerous case', () => {
    // Graph predicts 1 file, ground truth has 4 → P=1.0, R=0.25, F1=0.4
    const m = computeMetrics(1, ['a.ts', 'b.ts', 'c.ts', 'd.ts'], ['a.ts']);
    expect(m.truePositives).toBe(1);
    expect(m.falsePositives).toBe(0);
    expect(m.falseNegatives).toBe(3);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(0.25);
    expect(m.f1).toBeCloseTo(0.4);
  });

  it('partial overlap — most realistic case', () => {
    // 3 of 5 predicted are right; 2 of 4 ground-truth are caught.
    const m = computeMetrics(
      1,
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      ['a.ts', 'b.ts', 'c.ts', 'x.ts', 'y.ts'],
    );
    expect(m.truePositives).toBe(3);
    expect(m.falsePositives).toBe(2);
    expect(m.falseNegatives).toBe(1);
    expect(m.precision).toBe(0.6);
    expect(m.recall).toBe(0.75);
    expect(m.f1).toBeCloseTo(2 / 3, 3);
  });

  it('duplicate paths in input are deduped via Set', () => {
    // Both arrays have duplicates that should be treated as single entries.
    const m = computeMetrics(1, ['a.ts', 'a.ts', 'b.ts'], ['a.ts', 'a.ts', 'a.ts']);
    expect(m.truePositives).toBe(1);
    expect(m.falsePositives).toBe(0);
    expect(m.falseNegatives).toBe(1);
  });

  it('empty ground truth + empty prediction → F1 1.0 (the trivial-correct case)', () => {
    const m = computeMetrics(1, [], []);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
  });

  it('non-empty prediction against empty ground truth → F1 0 (false positives only)', () => {
    const m = computeMetrics(1, [], ['a.ts']);
    expect(m.truePositives).toBe(0);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(1); // recall is 1 when no ground truth (nothing to miss)
    expect(m.f1).toBe(0);
  });

  it('non-empty ground truth against empty prediction → F1 0 (false negatives only)', () => {
    const m = computeMetrics(1, ['a.ts'], []);
    expect(m.truePositives).toBe(0);
    expect(m.precision).toBe(1); // precision is 1 when no predictions (nothing flagged wrong)
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });

  it('PR number is carried through unchanged', () => {
    const m = computeMetrics(42, ['a.ts'], ['a.ts']);
    expect(m.prNumber).toBe(42);
  });
});

describe('avg', () => {
  it('empty array → 0', () => {
    expect(avg([])).toBe(0);
  });

  it('single element → that element', () => {
    expect(avg([0.42])).toBe(0.42);
  });

  it('multiple elements → arithmetic mean', () => {
    expect(avg([0.5, 0.6, 0.7])).toBeCloseTo(0.6);
  });

  it('handles zeros correctly (no NaN propagation)', () => {
    expect(avg([0, 0, 0])).toBe(0);
    expect(avg([1, 0, 1])).toBeCloseTo(0.667, 2);
  });
});
