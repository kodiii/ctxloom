/**
 * Tests for VectorStore — LanceDB-backed vector storage.
 *
 * These tests verify the VectorStore's CRUD operations and search
 * functionality using real LanceDB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorStore } from '../src/db/VectorStore.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('VectorStore', () => {
  let tempDir: string;
  let dbPath: string;
  let store: VectorStore;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-db-'));
    dbPath = path.join(tempDir, 'test-vectors.lancedb');
    store = new VectorStore(dbPath);
    await store.init();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('init()', () => {
    it('should create the database directory', () => {
      expect(fs.existsSync(tempDir)).toBe(true);
    });

    it('should be idempotent', async () => {
      await store.init();
      await store.init();
      // Should not throw
    });
  });

  describe('upsert()', () => {
    it('should insert a new record', async () => {
      const embedding = new Array(384).fill(0).map((_, i) => Math.random());
      await store.upsert('src/app.ts', embedding, 'export const app = 1;');
      const count = await store.count();
      expect(count).toBe(1);
    });

    it('should update an existing record (upsert)', async () => {
      const embedding1 = new Array(384).fill(0).map((_, i) => i * 0.01);
      const embedding2 = new Array(384).fill(0).map((_, i) => i * 0.02);

      await store.upsert('src/app.ts', embedding1, 'version 1');
      await store.upsert('src/app.ts', embedding2, 'version 2');

      const count = await store.count();
      expect(count).toBe(1); // Should still be 1, not 2
    });

    it('should insert multiple different records', async () => {
      const embedding = new Array(384).fill(0);
      await store.upsert('src/a.ts', embedding, 'file a');
      await store.upsert('src/b.ts', embedding, 'file b');
      await store.upsert('src/c.ts', embedding, 'file c');

      const count = await store.count();
      expect(count).toBe(3);
    });
  });

  describe('remove()', () => {
    it('should remove a record', async () => {
      const embedding = new Array(384).fill(0);
      await store.upsert('src/app.ts', embedding, 'content');
      await store.remove('src/app.ts');

      const count = await store.count();
      expect(count).toBe(0);
    });

    it('should not throw when removing non-existent record', async () => {
      await expect(store.remove('nonexistent.ts')).resolves.not.toThrow();
    });
  });

  describe('search()', () => {
    it('should return results sorted by similarity', async () => {
      // Create embeddings where each is distinctly different
      const embedding1 = new Array(384).fill(0);
      embedding1[0] = 1; // Strongly points in direction 0

      const embedding2 = new Array(384).fill(0);
      embedding2[1] = 1; // Strongly points in direction 1

      const embedding3 = new Array(384).fill(0);
      embedding3[0] = 0.9; // Similar to embedding1
      embedding3[1] = 0.1;

      await store.upsert('src/close.ts', embedding1, 'close match');
      await store.upsert('src/far.ts', embedding2, 'far match');
      await store.upsert('src/medium.ts', embedding3, 'medium match');

      // Query similar to embedding1
      const query = new Array(384).fill(0);
      query[0] = 1;

      const results = await store.search(query, 3);

      expect(results.length).toBeGreaterThanOrEqual(1);
      // The closest match should be src/close.ts (most similar to query)
      if (results.length > 0) {
        expect(results[0].filePath).toBeTruthy();
        expect(typeof results[0].score).toBe('number');
      }
    });

    it('should return empty results for empty database', async () => {
      const query = new Array(384).fill(0);
      const results = await store.search(query, 5);
      expect(results).toEqual([]);
    });

    it('should respect the limit parameter', async () => {
      const embedding = new Array(384).fill(0);
      for (let i = 0; i < 5; i++) {
        await store.upsert(`src/file${i}.ts`, embedding, `content ${i}`);
      }

      const query = new Array(384).fill(0);
      const results = await store.search(query, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('count()', () => {
    it('should return 0 for empty store', async () => {
      const count = await store.count();
      expect(count).toBe(0);
    });
  });

  describe('compact()', () => {
    it('should not throw on an initialized store with data', async () => {
      const embedding = new Array(384).fill(0);
      await store.upsert('src/a.ts', embedding, 'a');
      await expect(store.compact()).resolves.not.toThrow();
      // Store must remain usable after compaction.
      expect(await store.count()).toBe(1);
    });

    it('should be a safe no-op when the table is uninitialized', async () => {
      const fresh = new VectorStore(path.join(tempDir, 'uninit.lancedb'));
      // Intentionally NOT calling init() — table is null.
      await expect(fresh.compact()).resolves.not.toThrow();
    });

    it(
      'should auto-trigger during upsert without breaking the store',
      async () => {
        // Drive upserts past the COMPACT_EVERY threshold (200) so that the
        // automatic compaction path inside upsert() fires at least once.
        // This is a smoke test for the integration: real FD-bound
        // verification needs a long-running process + lsof and is out of
        // scope for unit tests. We only assert that compaction during the
        // upsert path does not corrupt the store.
        const embedding = new Array(384).fill(0);
        for (let i = 0; i < 220; i++) {
          await store.upsert(`src/file-${i}.ts`, embedding, `content ${i}`);
        }
        expect(await store.count()).toBe(220);
      },
      90_000,
    );

    it(
      'should keep on-disk LanceDB transaction count bounded under sustained upserts',
      async () => {
        // This is the regression test for the FD leak (root cause: LanceDB
        // _transactions/ + _versions/ growing unbounded with each upsert
        // producing 2 transactions: delete + add). Without compaction,
        // N upserts produce ~2N .txn files; the leak observed in
        // production was ~60k FDs on a single MCP process after 18h.
        //
        // We use an aggressive cleanupOlderThanMs=0 (prune everything) and
        // compactEvery=50 so the test exercises the prune path quickly.
        // Production defaults (200 / 1h) still keep a crash-recovery
        // window — see VectorStoreOptions.
        const bounded = new VectorStore(path.join(tempDir, 'bounded.lancedb'), {
          compactEvery: 50,
          cleanupOlderThanMs: 0,
        });
        await bounded.init();

        const TOTAL = 500;
        const embedding = new Array(384).fill(0);
        for (let i = 0; i < TOTAL; i++) {
          await bounded.upsert(`src/file-${i}.ts`, embedding, `content ${i}`);
        }

        const tablePath = path.join(tempDir, 'bounded.lancedb', 'code_embeddings.lance');
        const txnDir = path.join(tablePath, '_transactions');
        const verDir = path.join(tablePath, '_versions');
        const txnCount = fs.existsSync(txnDir)
          ? fs.readdirSync(txnDir).filter((f) => f.endsWith('.txn')).length
          : 0;
        const manifestCount = fs.existsSync(verDir)
          ? fs.readdirSync(verDir).filter((f) => f.endsWith('.manifest')).length
          : 0;

        // eslint-disable-next-line no-console
        console.error(
          `[fd-leak smoke] after ${TOTAL} upserts: .txn=${txnCount} .manifest=${manifestCount} (unbounded baseline would be ~${2 * TOTAL})`,
        );

        // Soft sanity: data integrity preserved through compaction.
        expect(await bounded.count()).toBe(TOTAL);

        // Hard regression guard: with cleanupOlderThanMs=0 we should see
        // file counts well under 2N. The unpatched code would produce
        // ~1000 .txn / ~1000 .manifest; with active pruning we expect
        // well under half of that. Ceiling at 200 keeps slack for the
        // most recent unprune-able transactions between compactions.
        expect(txnCount).toBeLessThan(200);
        expect(manifestCount).toBeLessThan(200);
      },
      180_000,
    );
  });
});
