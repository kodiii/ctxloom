/**
 * Tests for the indexer's directory-ignore predicate.
 *
 * Pre-fix the ignore list covered JS/TS noise (node_modules, dist,
 * .next, etc.) but had zero coverage for standard Python project
 * directories. Real-world repro: EasyMoney (63 source files +
 * `.venv/` with 8,192 installed-package files) made `ctxloom index`
 * report 8,120 files / 14,138 edges instead of 63 / 97.
 *
 * These tests pin the v1.7.4 fix that adds .venv / venv / env /
 * __pycache__ / .pytest_cache / .ruff_cache / .mypy_cache / .tox to
 * the exact-match set AND adds suffix matching for *.egg-info /
 * *.dist-info (setuptools per-package artifact directories whose
 * names vary per project).
 *
 * Also pins the original JS/TS exact-match behavior so the next
 * person who adds an ignore entry doesn't accidentally regress it.
 */
import { describe, it, expect } from 'vitest';
import { isIgnoredDir, INDEXER_IGNORED_DIRS } from '../packages/core/src/indexer/embedder.js';

describe('isIgnoredDir', () => {
  describe('Python virtualenvs and caches (v1.7.4)', () => {
    it.each([
      '.venv', 'venv', 'env',
      '__pycache__',
      '.pytest_cache', '.ruff_cache', '.mypy_cache', '.tox',
    ])('ignores %s', (name) => {
      expect(isIgnoredDir(name)).toBe(true);
    });
  });

  describe('setuptools per-package artifacts (suffix match)', () => {
    it.each([
      'easymoney.egg-info',
      'mylib.egg-info',
      'some_long_package_name.egg-info',
      // dist-info shows up under site-packages but also in wheel build
      // dirs; same suffix-match treatment.
      'requests-2.31.0.dist-info',
      'numpy-1.26.4.dist-info',
    ])('ignores %s via suffix match', (name) => {
      expect(isIgnoredDir(name)).toBe(true);
    });

    it('does NOT ignore a file just because its name contains .egg-info', () => {
      // Suffix check is on directory names, but the predicate has no
      // way to know that — its job is just "should this name be
      // treated as ignorable if it WERE a dir?". A file with the same
      // name would (correctly) be skipped by INDEX_SUPPORTED_EXTENSIONS
      // anyway. Pinning the predicate for documentation purposes:
      expect(isIgnoredDir('readme.egg-info-notes')).toBe(false);
      expect(isIgnoredDir('.egg-info-backup')).toBe(false);
    });
  });

  describe('original JS/TS + version-control set is preserved', () => {
    it.each([
      'node_modules', 'dist', 'build', 'out', 'target',
      'coverage', '.cache', '.turbo', '.next', '.nuxt',
      '.git', '.ctxloom',
      '.claude', '.code-review-graph', '.vscode-test',
    ])('still ignores %s', (name) => {
      expect(isIgnoredDir(name)).toBe(true);
    });
  });

  describe('false positives we should NOT accidentally ignore', () => {
    it.each([
      'src', 'lib', 'app', 'tests', 'spec',
      'my-project', 'venv-config', // venv is exact-match; substrings are fine
      'node-modules-helper', // hyphenated, exact-match-safe
      'env_loader', // env is exact-match; substrings/extensions are fine
    ])('does not ignore %s', (name) => {
      expect(isIgnoredDir(name)).toBe(false);
    });
  });

  describe('INDEXER_IGNORED_DIRS export is the single source of truth', () => {
    it('every entry in INDEXER_IGNORED_DIRS is recognized by isIgnoredDir', () => {
      // Guards against the historical bug where the synchronous
      // walker had a literal duplicate of the ignore list that
      // silently drifted from the exported one.
      for (const name of INDEXER_IGNORED_DIRS) {
        expect(isIgnoredDir(name)).toBe(true);
      }
    });
  });
});
