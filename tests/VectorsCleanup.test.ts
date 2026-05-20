/**
 * Tests for the vectors-cleanup pure logic.
 *
 * Verifies the `inspectVectorsDb` + `cleanupVectors` functions handle:
 *   - missing DB (no-op return)
 *   - present DB (counts + rename to .bak-<ts>)
 *   - active-process refusal (caller-injected PIDs)
 *   - dry-run mode (no disk side effects)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cleanupVectors, inspectVectorsDb } from '../src/db/vectorsCleanup.js';

describe('vectorsCleanup', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-vc-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Seed a fake LanceDB directory structure with N files of each type.
  // Lets us exercise the counting + rename paths without actually
  // booting LanceDB.
  function seedDb(
    rootDir: string,
    counts: { txn?: number; manifest?: number; lance?: number } = {},
  ): void {
    const tablePath = path.join(rootDir, '.ctxloom', 'vectors.lancedb', 'code_embeddings.lance');
    fs.mkdirSync(path.join(tablePath, '_transactions'), { recursive: true });
    fs.mkdirSync(path.join(tablePath, '_versions'), { recursive: true });
    fs.mkdirSync(path.join(tablePath, 'data'), { recursive: true });
    for (let i = 0; i < (counts.txn ?? 0); i += 1) {
      fs.writeFileSync(path.join(tablePath, '_transactions', `${i}.txn`), 'x'.repeat(100));
    }
    for (let i = 0; i < (counts.manifest ?? 0); i += 1) {
      fs.writeFileSync(path.join(tablePath, '_versions', `${i}.manifest`), 'y'.repeat(50));
    }
    for (let i = 0; i < (counts.lance ?? 0); i += 1) {
      fs.writeFileSync(path.join(tablePath, 'data', `${i}.lance`), 'z'.repeat(200));
    }
  }

  describe('inspectVectorsDb()', () => {
    it('returns zero counts when the DB does not exist', () => {
      const counts = inspectVectorsDb(tempDir);
      expect(counts).toEqual({ txn: 0, manifest: 0, lance: 0, totalBytes: 0 });
    });

    it('counts files by extension and sums bytes', () => {
      seedDb(tempDir, { txn: 5, manifest: 3, lance: 2 });
      const counts = inspectVectorsDb(tempDir);
      expect(counts.txn).toBe(5);
      expect(counts.manifest).toBe(3);
      expect(counts.lance).toBe(2);
      // 5*100 + 3*50 + 2*200 = 500 + 150 + 400
      expect(counts.totalBytes).toBe(1050);
    });

    it('ignores subdirectories that do not exist', () => {
      const partial = path.join(tempDir, '.ctxloom', 'vectors.lancedb', 'code_embeddings.lance');
      fs.mkdirSync(partial, { recursive: true });
      // No _transactions / _versions / data subdirs at all.
      const counts = inspectVectorsDb(tempDir);
      expect(counts).toEqual({ txn: 0, manifest: 0, lance: 0, totalBytes: 0 });
    });
  });

  describe('cleanupVectors()', () => {
    it('returns no-db when there is nothing to clean', () => {
      const result = cleanupVectors({ rootDir: tempDir });
      expect(result.cleaned).toBe(false);
      expect(result.reason).toBe('no-db');
    });

    it('refuses when active PIDs are passed', () => {
      seedDb(tempDir, { txn: 1 });
      const result = cleanupVectors({ rootDir: tempDir }, [9999]);
      expect(result.cleaned).toBe(false);
      expect(result.reason).toBe('in-use');
      expect(result.conflictingPids).toEqual([9999]);
      // The DB must remain on disk if we refused.
      expect(fs.existsSync(path.join(tempDir, '.ctxloom', 'vectors.lancedb'))).toBe(true);
    });

    it('dry-run does not touch disk', () => {
      seedDb(tempDir, { txn: 2 });
      const result = cleanupVectors({ rootDir: tempDir, dryRun: true });
      expect(result.cleaned).toBe(true);
      expect(result.before?.txn).toBe(2);
      expect(result.backupPath).toBeUndefined();
      // Directory still there.
      expect(fs.existsSync(path.join(tempDir, '.ctxloom', 'vectors.lancedb'))).toBe(true);
    });

    it('renames the DB to a timestamped backup on success', () => {
      seedDb(tempDir, { txn: 1, manifest: 1, lance: 1 });
      const result = cleanupVectors({ rootDir: tempDir });
      expect(result.cleaned).toBe(true);
      expect(result.backupPath).toMatch(/vectors\.lancedb\.bak-/);
      // Original gone, backup present.
      expect(fs.existsSync(path.join(tempDir, '.ctxloom', 'vectors.lancedb'))).toBe(false);
      expect(fs.existsSync(result.backupPath!)).toBe(true);
      // Counts in the report reflect pre-cleanup state.
      expect(result.before).toEqual({
        txn: 1,
        manifest: 1,
        lance: 1,
        totalBytes: 100 + 50 + 200,
      });
    });

    it('handles a large file count without throwing', () => {
      // Mimics the production debris scenario from PR #173 (~20k .txn).
      // Keep the test small enough to be quick but enough to prove the
      // walk doesn't fall over on realistic counts.
      seedDb(tempDir, { txn: 500, manifest: 200, lance: 50 });
      const counts = inspectVectorsDb(tempDir);
      expect(counts.txn).toBe(500);
      expect(counts.manifest).toBe(200);
      expect(counts.lance).toBe(50);

      const result = cleanupVectors({ rootDir: tempDir });
      expect(result.cleaned).toBe(true);
    });
  });
});
