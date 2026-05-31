/**
 * Tests for v1.7.9 vector-store corruption legibility.
 *
 * Incident: a corrupt LanceDB store (manifest references a pruned data
 * fragment) read its metadata fine — count() returned a stale row count,
 * ctx_status said vectors="ready" — but every search threw a lance
 * `Not found: .../data/<frag>.lance` error that search() swallowed as
 * `return []`. So corruption masqueraded as "no results matched": the
 * worst failure mode, indistinguishable from a healthy empty store. It
 * cost a multi-turn debugging session chasing phantom causes.
 *
 * Fix: isCorruptionError() distinguishes a missing-fragment error from a
 * benign empty/unindexed store; search() + findEmbeddingByPath() throw an
 * actionable error on corruption (recovery command) instead of hiding it;
 * a new probe() lets ctx_status report vectors="corrupt".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorStore, isCorruptionError } from '../src/db/VectorStore.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIM = 384;
const vec = (s: number): number[] =>
  new Array(DIM).fill(0).map((_, i) => ((s * 31 + i) % 97) / 97 + 0.01);

/** Delete the newest data fragment to simulate a manifest/fragment desync. */
function corruptStore(dbPath: string): void {
  const dataDir = path.join(dbPath, 'code_embeddings.lance', 'data');
  const frags = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.lance'))
    .map((f) => ({ f, mt: fs.statSync(path.join(dataDir, f)).mtimeMs }))
    .sort((a, b) => b.mt - a.mt);
  if (frags.length === 0) throw new Error('no data fragments to corrupt');
  fs.rmSync(path.join(dataDir, frags[0].f));
}

describe('isCorruptionError', () => {
  it('is true for a missing .lance data fragment', () => {
    expect(isCorruptionError(new Error('Not found: /x/code_embeddings.lance/data/abc.lance'))).toBe(true);
  });
  it('is true for a missing _deletions .arrow file', () => {
    expect(isCorruptionError(new Error('Not found: /x/code_embeddings.lance/_deletions/y.arrow'))).toBe(true);
  });
  it('is false for a generic error', () => {
    expect(isCorruptionError(new Error('connection reset'))).toBe(false);
  });
  it('is false for a "not found" without an artifact path', () => {
    expect(isCorruptionError(new Error('table not found'))).toBe(false);
  });
  it('handles non-Error values', () => {
    expect(isCorruptionError('Not found: a/data/b.lance')).toBe(true);
    expect(isCorruptionError(null)).toBe(false);
  });
});

describe('VectorStore corruption handling', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-corrupt-'));
    dbPath = path.join(tempDir, 'vectors.lancedb');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('search() THROWS an actionable error on a corrupt store (not [])', async () => {
    const builder = new VectorStore(dbPath);
    await builder.init();
    await builder.upsert('a.ts', vec(1), 'alpha');
    await builder.upsert('b.ts', vec(2), 'beta');
    await builder.upsert('c.ts', vec(3), 'gamma');
    await builder.close();

    // Simulate the desync: drop a referenced fragment from disk.
    corruptStore(dbPath);

    // A fresh process opens the now-corrupt store (mirrors the incident:
    // a server that opens an already-corrupt store).
    const reader = new VectorStore(dbPath);
    await reader.init();
    await expect(reader.search(vec(1), 5)).rejects.toThrow(/corrupt/i);
    await expect(reader.search(vec(1), 5)).rejects.toThrow(/ctxloom vectors-cleanup/);
    await reader.close();
  });

  it('findEmbeddingByPath() THROWS on a corrupt store (not null)', async () => {
    const builder = new VectorStore(dbPath);
    await builder.init();
    await builder.upsert('a.ts', vec(1), 'alpha');
    await builder.upsert('b.ts', vec(2), 'beta');
    await builder.close();

    corruptStore(dbPath);

    const reader = new VectorStore(dbPath);
    await reader.init();
    await expect(reader.findEmbeddingByPath('a.ts')).rejects.toThrow(/corrupt/i);
    await reader.close();
  });

  it('search() returns [] on a benign EMPTY store (no false corruption)', async () => {
    const store = new VectorStore(dbPath);
    await store.init(); // seed row deleted in init → genuinely empty
    const results = await store.search(vec(1), 5);
    expect(results).toEqual([]);
    await store.close();
  });

  it('probe() resolves on a healthy store and throws on a corrupt one', async () => {
    const builder = new VectorStore(dbPath);
    await builder.init();
    await builder.upsert('a.ts', vec(1), 'alpha');
    // Healthy probe — resolves.
    await expect(builder.probe()).resolves.toBeUndefined();
    await builder.close();

    corruptStore(dbPath);
    const reader = new VectorStore(dbPath);
    await reader.init();
    let threw: unknown = null;
    try {
      await reader.probe();
    } catch (e) {
      threw = e;
    }
    expect(threw).not.toBeNull();
    expect(isCorruptionError(threw)).toBe(true);
    await reader.close();
  });
});
