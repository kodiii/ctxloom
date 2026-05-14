/**
 * Tests for `parseUnifiedDiff` — the pure parser half of the diff
 * helper. The git-subprocess side is integration-tested at runtime
 * by the gutter provider; unit-testing it would require a real repo,
 * which the analyzeWorkingTree.test suite already covers end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../../src/review/getChangedLineRanges.js';

describe('parseUnifiedDiff', () => {
  it('returns an empty list for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('extracts a single-line hunk (count omitted defaults to 1)', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index 0000001..0000002 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -10 +10 @@',
      '-old',
      '+new',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    expect(result).toEqual([
      { file: 'src/foo.ts', ranges: [{ start: 10, count: 1 }] },
    ]);
  });

  it('extracts a multi-line hunk with explicit count', () => {
    const diff = [
      'diff --git a/src/bar.ts b/src/bar.ts',
      '@@ -50,2 +50,5 @@',
      '-a',
      '-b',
      '+c',
      '+d',
      '+e',
      '+f',
      '+g',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    expect(result).toEqual([
      { file: 'src/bar.ts', ranges: [{ start: 50, count: 5 }] },
    ]);
  });

  it('groups multiple hunks under the same file', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '@@ -10 +10,2 @@',
      '+x',
      '+y',
      '@@ -50 +51 @@',
      '+z',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    expect(result).toEqual([
      {
        file: 'src/a.ts',
        ranges: [
          { start: 10, count: 2 },
          { start: 51, count: 1 },
        ],
      },
    ]);
  });

  it('separates hunks across multiple files', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '@@ -1 +1 @@',
      '+a',
      'diff --git a/src/b.ts b/src/b.ts',
      '@@ -5 +5,3 @@',
      '+b1',
      '+b2',
      '+b3',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ file: 'src/a.ts', ranges: [{ start: 1, count: 1 }] });
    expect(result[1]).toEqual({ file: 'src/b.ts', ranges: [{ start: 5, count: 3 }] });
  });

  it('drops pure-deletion hunks (count = 0 on new side)', () => {
    // `@@ -10,3 +10,0 @@` is a pure deletion — nothing new to mark.
    // Regex requires count > 0 so this hunk falls through, but the
    // file entry still appears (with empty ranges).
    const diff = [
      'diff --git a/src/deleted.ts b/src/deleted.ts',
      '@@ -10,3 +10,0 @@',
      '-a',
      '-b',
      '-c',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    expect(result).toEqual([{ file: 'src/deleted.ts', ranges: [] }]);
  });

  it('uses the post-rename path (b/<file>) for renames', () => {
    const diff = [
      'diff --git a/src/old-name.ts b/src/new-name.ts',
      'similarity index 90%',
      'rename from src/old-name.ts',
      'rename to src/new-name.ts',
      '@@ -1 +1 @@',
      '+changed',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    expect(result).toEqual([
      { file: 'src/new-name.ts', ranges: [{ start: 1, count: 1 }] },
    ]);
  });

  it('handles paths with spaces and unicode', () => {
    const diff = [
      'diff --git a/src/my folder/file 名前.ts b/src/my folder/file 名前.ts',
      '@@ -3 +3 @@',
      '+x',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    expect(result).toEqual([
      { file: 'src/my folder/file 名前.ts', ranges: [{ start: 3, count: 1 }] },
    ]);
  });
});
