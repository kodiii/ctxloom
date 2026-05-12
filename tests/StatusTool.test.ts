/**
 * Tests for ctx_status — specifically the disk-aware vector-store check.
 *
 * Regression for: issue #55. Before the fix, `isStoreInitialized()` was
 * `_storePromise !== null` (process-local lazy state), so a fresh MCP server
 * boot always reported `<vector_store status="not_initialized" />` even when
 * `ctxloom index` had previously populated the LanceDB table on disk. The
 * status tool now treats a present `code_embeddings.lance` directory as
 * "initialized" regardless of whether the lazy singleton is warm.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerStatusTool } from '../src/tools/status.js';
import { VectorStore } from '../src/db/VectorStore.js';
import type { ServerContext } from '../src/tools/context.js';

function makeCtx(overrides: Partial<ServerContext>): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not used')),
    getGraph: () => Promise.reject(new Error('not used')),
    getParser: () => Promise.reject(new Error('not used')),
    getSkeletonizer: () => Promise.reject(new Error('not used')),
    getRuleManager: () => { throw new Error('not used'); },
    getPathValidator: () => { throw new Error('not used'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
    ...overrides,
  };
}

describe('ctx_status — vector store reporting', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-status-'));
    dbPath = path.join(tempDir, 'vectors.lancedb');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports not_initialized when no store exists in process or on disk', async () => {
    const registry = new ToolRegistry();
    registerStatusTool(registry, makeCtx({ dbPath }));
    const result = await registry.dispatch('ctx_status', {});
    expect(result).toContain('<vector_store status="not_initialized" />');
  });

  it('reports ready with record count after a fresh indexing run, with no warm singleton', async () => {
    // Populate the store on disk, then close it — simulating a completed
    // `ctxloom index` run from a separate process.
    const writer = new VectorStore(dbPath);
    await writer.init();
    const embedding = new Array(384).fill(0).map(() => Math.random());
    await writer.upsert('src/a.ts', embedding, 'file a');
    await writer.upsert('src/b.ts', embedding, 'file b');
    await writer.close();

    // Now build a context with a cold singleton (no prior getStore() call)
    // but mark store as initialized because the directory exists on disk.
    // The simulated `isStoreInitialized` returns true when the table dir
    // is present — mirroring the disk check added in src/server.ts.
    let storeSingleton: VectorStore | null = null;
    const ctx = makeCtx({
      dbPath,
      getStore: async () => {
        if (!storeSingleton) {
          storeSingleton = new VectorStore(dbPath);
          await storeSingleton.init();
        }
        return storeSingleton;
      },
      isStoreInitialized: () =>
        storeSingleton !== null || fs.existsSync(path.join(dbPath, 'code_embeddings.lance')),
    });

    const registry = new ToolRegistry();
    registerStatusTool(registry, ctx);
    const result = await registry.dispatch('ctx_status', {});

    expect(result).toContain('<vector_store status="ready"');
    expect(result).toMatch(/records="2"/);

    // Cleanup the in-test singleton if it was opened by status.
    if (storeSingleton) await (storeSingleton as VectorStore).close();
  });
});

describe('VectorStore persistence', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-persist-'));
    dbPath = path.join(tempDir, 'vectors.lancedb');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists upserts across close/reopen', async () => {
    const writer = new VectorStore(dbPath);
    await writer.init();
    const embedding = new Array(384).fill(0).map((_, i) => (i % 7) * 0.1);
    await writer.upsert('src/a.ts', embedding, 'file a');
    await writer.upsert('src/b.ts', embedding, 'file b');
    await writer.upsert('src/c.ts', embedding, 'file c');
    await writer.close();

    // The on-disk table dir exists immediately after close.
    expect(fs.existsSync(path.join(dbPath, 'code_embeddings.lance'))).toBe(true);

    // A fresh VectorStore instance against the same path sees all records.
    const reader = new VectorStore(dbPath);
    await reader.init();
    const count = await reader.count();
    expect(count).toBe(3);
    await reader.close();
  });
});
