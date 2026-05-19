/**
 * Unit tests for the F1/precision/recall calculations the public
 * benchmark numbers rest on. Pure functions, no I/O, no graph
 * dependencies — easy to test exhaustively, and critical to get
 * right because we'll be publishing these numbers in a setting
 * where reviewers will check them.
 */
import { describe, it, expect } from 'vitest';
import { computeMetrics, avg } from '../scripts/bench/metrics.js';

/**
 * Inline source predicate matching the bench's real predicate shape:
 * common code extensions count as source; everything else doesn't.
 * The real predicate is `isSourceFile` in scripts/bench/groundTruth.ts.
 * Tests stay pure with a tiny inline duplicate so this suite has no
 * imports beyond the unit under test.
 */
const isSourceTest = (p: string): boolean =>
  /\.(ts|tsx|js|jsx|py|go|rb|java|cs|rs|mjs|cjs)$/.test(p);

describe('computeMetrics', () => {
  it('perfect prediction → F1 1.0', () => {
    const m = computeMetrics(
      1,
      ['a.ts', 'b.ts', 'c.ts'],
      ['a.ts', 'b.ts', 'c.ts'],
      isSourceTest,
    );
    expect(m.truePositives).toBe(3);
    expect(m.falsePositives).toBe(0);
    expect(m.falseNegatives).toBe(0);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.sourceGroundTruthCount).toBe(3);
    expect(m.sourceTruePositives).toBe(3);
    expect(m.sourceRecall).toBe(1);
  });

  it('no prediction overlap with ground truth → F1 0', () => {
    const m = computeMetrics(1, ['a.ts', 'b.ts'], ['c.ts', 'd.ts'], isSourceTest);
    expect(m.truePositives).toBe(0);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
    expect(m.sourceRecall).toBe(0);
  });

  it('over-prediction (high recall, low precision) — characteristic of conservative blast radius', () => {
    const m = computeMetrics(
      1,
      ['a.ts', 'b.ts'],
      ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      isSourceTest,
    );
    expect(m.truePositives).toBe(2);
    expect(m.falsePositives).toBe(3);
    expect(m.falseNegatives).toBe(0);
    expect(m.precision).toBeCloseTo(0.4);
    expect(m.recall).toBe(1);
    expect(m.f1).toBeCloseTo(0.5714, 3);
  });

  it('under-prediction (high precision, low recall) — the dangerous case', () => {
    const m = computeMetrics(
      1,
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      ['a.ts'],
      isSourceTest,
    );
    expect(m.truePositives).toBe(1);
    expect(m.falsePositives).toBe(0);
    expect(m.falseNegatives).toBe(3);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(0.25);
    expect(m.f1).toBeCloseTo(0.4);
  });

  it('partial overlap — most realistic case', () => {
    const m = computeMetrics(
      1,
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      ['a.ts', 'b.ts', 'c.ts', 'x.ts', 'y.ts'],
      isSourceTest,
    );
    expect(m.truePositives).toBe(3);
    expect(m.falsePositives).toBe(2);
    expect(m.falseNegatives).toBe(1);
    expect(m.precision).toBe(0.6);
    expect(m.recall).toBe(0.75);
    expect(m.f1).toBeCloseTo(2 / 3, 3);
  });

  it('duplicate paths in input are deduped via Set', () => {
    const m = computeMetrics(
      1,
      ['a.ts', 'a.ts', 'b.ts'],
      ['a.ts', 'a.ts', 'a.ts'],
      isSourceTest,
    );
    expect(m.truePositives).toBe(1);
    expect(m.falsePositives).toBe(0);
    expect(m.falseNegatives).toBe(1);
  });

  it('empty ground truth + empty prediction → F1 1.0 (the trivial-correct case)', () => {
    const m = computeMetrics(1, [], [], isSourceTest);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.sourceGroundTruthCount).toBe(0);
    expect(m.sourceRecall).toBe(1);
  });

  it('non-empty prediction against empty ground truth → F1 0 (false positives only)', () => {
    const m = computeMetrics(1, [], ['a.ts'], isSourceTest);
    expect(m.truePositives).toBe(0);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(0);
  });

  it('non-empty ground truth against empty prediction → F1 0 (false negatives only)', () => {
    const m = computeMetrics(1, ['a.ts'], [], isSourceTest);
    expect(m.truePositives).toBe(0);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });

  it('PR number is carried through unchanged', () => {
    const m = computeMetrics(42, ['a.ts'], ['a.ts'], isSourceTest);
    expect(m.prNumber).toBe(42);
  });

  /**
   * Source-file recall tests — the new metric.
   *
   * The bench's express #6903 case in real life: GT included
   * History.md (changelog), lib/application.js, test/app.render.js.
   * The graph can't predict History.md. Total recall = 2/3 = 0.67;
   * source-file recall = 2/2 = 1.00.
   */
  describe('source-file recall', () => {
    it('unindexable GT files (md/yml/json) excluded from denominator', () => {
      // Mirror the real express #6903 case.
      const m = computeMetrics(
        1,
        ['History.md', 'lib/application.js', 'test/app.render.js'],
        ['lib/application.js', 'test/app.render.js'],
        isSourceTest,
      );
      // Total recall: 2 of 3 GT predicted = 0.67
      expect(m.recall).toBeCloseTo(2 / 3, 3);
      // Source recall: History.md filtered out of denominator → 2 of 2 = 1.00
      expect(m.sourceGroundTruthCount).toBe(2);
      expect(m.sourceTruePositives).toBe(2);
      expect(m.sourceRecall).toBe(1);
    });

    it('only-non-source GT (all docs) → sourceGroundTruthCount=0, sourceRecall=1', () => {
      // Edge case: a docs-only PR. The bench's methodology gate
      // would reject this PR upstream, but the metric should still
      // handle it sanely if it reaches us.
      const m = computeMetrics(1, ['README.md', 'CHANGELOG.md'], [], isSourceTest);
      expect(m.sourceGroundTruthCount).toBe(0);
      expect(m.sourceTruePositives).toBe(0);
      // Convention: source recall = 1 when there are no source files
      // to find (nothing to miss). Matches total-recall convention.
      expect(m.sourceRecall).toBe(1);
    });

    it('mixed GT: predicted captures only docs, missed all source', () => {
      const m = computeMetrics(
        1,
        ['README.md', 'lib/a.ts', 'lib/b.ts'],
        ['README.md'], // imaginary — graph wouldn't actually predict docs
        isSourceTest,
      );
      // Total recall: 1/3 = 0.33
      expect(m.recall).toBeCloseTo(1 / 3, 3);
      // Source recall: 0/2 = 0 (missed both lib files)
      expect(m.sourceRecall).toBe(0);
      expect(m.sourceGroundTruthCount).toBe(2);
      expect(m.sourceTruePositives).toBe(0);
    });

    it('source recall ≥ total recall when GT contains unindexable files', () => {
      // Property test in concrete form: dropping unindexable items
      // from the denominator can only increase (or equal) the ratio.
      const m = computeMetrics(
        1,
        ['package.json', 'src/foo.ts', 'src/bar.ts', 'src/baz.ts'],
        ['src/foo.ts', 'src/bar.ts'],
        isSourceTest,
      );
      expect(m.recall).toBe(0.5); // 2/4 total
      expect(m.sourceRecall).toBeCloseTo(2 / 3, 3); // 2/3 source
      expect(m.sourceRecall).toBeGreaterThanOrEqual(m.recall);
    });
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
