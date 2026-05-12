/**
 * Tests for ctx_status — multi-project view and schema.
 *
 * Historical note: Issue #55 tested disk-aware vector-store reporting via
 * isStoreInitialized(). The #70 refactor replaced the per-resource status
 * fields with the multi-project <active_projects> block backed by
 * ProjectStateManager. Vector store state is now visible as vectors="cold" |
 * "building" | "ready" on each <project> entry.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerStatusTool } from '../src/tools/status.js';
import { VectorStore } from '../src/db/VectorStore.js';
import { ProjectStateManager } from '../src/server/ProjectStateManager.js';
import type { ServerContext } from '../src/tools/context.js';
import type { RepoRegistry } from '../src/tools/cross-repo-search.js';

const mockRegistry = { list: () => [], findByAlias: () => null, findByPath: () => null } as unknown as RepoRegistry;

function makeCtx(overrides: Partial<ServerContext>): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    noDefaultMode: false,
    registry: mockRegistry,
    stateManager: new ProjectStateManager({ maxProjects: 5 }),
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

describe('ctx_status — multi-project output', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-status-'));
    dbPath = path.join(tempDir, 'vectors.lancedb');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('shows vectors="cold" when no project state has been touched', async () => {
    const mgr = new ProjectStateManager({ maxProjects: 5 });
    mgr.pin('/fake');
    const registry = new ToolRegistry();
    registerStatusTool(registry, makeCtx({ stateManager: mgr, dbPath }));
    const result = await registry.dispatch('ctx_status', {});
    expect(result).toMatch(/vectors="cold"/);
    expect(result).toMatch(/<active_projects count="1" max="5">/);
  });

  it('shows vectors="ready" when vectorsInitialized is set on the state', async () => {
    const mgr = new ProjectStateManager({ maxProjects: 5 });
    const state = mgr.pin('/fake');
    state.vectorsInitialized = true;
    const registry = new ToolRegistry();
    registerStatusTool(registry, makeCtx({ stateManager: mgr, dbPath }));
    const result = await registry.dispatch('ctx_status', {});
    expect(result).toMatch(/vectors="ready"/);
  });
});

describe('ctx_status — input schema', () => {
  it('ctx_status schema accepts project_root', () => {
    const registry = new ToolRegistry();
    registerStatusTool(registry, makeCtx({}));
    const status = registry.list().find((t) => t.name === 'ctx_status');
    expect(status?.inputSchema.properties).toHaveProperty('project_root');
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
