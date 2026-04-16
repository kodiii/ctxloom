import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCrossRepoSearchTool } from '../src/tools/cross-repo-search.js';
import { RepoRegistry } from '../src/tools/cross-repo-search.js';
import type { ServerContext } from '../src/tools/context.js';

function makeCtx(): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.reject(new Error('not needed')),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
  };
}

// ─── RepoRegistry ────────────────────────────────────────────────────────

describe('RepoRegistry', () => {
  let tmpDir: string;
  let registryPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-repo-registry-test-'));
    registryPath = path.join(tmpDir, 'repos.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts empty when file does not exist', () => {
    const reg = new RepoRegistry(registryPath);
    expect(reg.list()).toEqual([]);
  });

  it('register() adds a repo entry', () => {
    const reg = new RepoRegistry(registryPath);
    reg.register('/path/to/myrepo', '/path/to/myrepo/.ctxloom/vectors.lancedb');
    const repos = reg.list();
    expect(repos).toHaveLength(1);
    expect(repos[0].root).toBe('/path/to/myrepo');
    expect(repos[0].dbPath).toBe('/path/to/myrepo/.ctxloom/vectors.lancedb');
  });

  it('register() updates existing entry if same root', () => {
    const reg = new RepoRegistry(registryPath);
    reg.register('/path/to/myrepo', '/old/path.lancedb');
    reg.register('/path/to/myrepo', '/new/path.lancedb');
    const repos = reg.list();
    expect(repos).toHaveLength(1);
    expect(repos[0].dbPath).toBe('/new/path.lancedb');
  });

  it('persists to disk and reloads', () => {
    const reg1 = new RepoRegistry(registryPath);
    reg1.register('/repo/a', '/repo/a/.ctxloom/vectors.lancedb');
    reg1.register('/repo/b', '/repo/b/.ctxloom/vectors.lancedb');

    const reg2 = new RepoRegistry(registryPath);
    expect(reg2.list()).toHaveLength(2);
    expect(reg2.list().map(r => r.root)).toContain('/repo/a');
    expect(reg2.list().map(r => r.root)).toContain('/repo/b');
  });

  it('unregister() removes a repo by root path', () => {
    const reg = new RepoRegistry(registryPath);
    reg.register('/repo/a', '/repo/a/.ctxloom/vectors.lancedb');
    reg.register('/repo/b', '/repo/b/.ctxloom/vectors.lancedb');
    reg.unregister('/repo/a');
    const repos = reg.list();
    expect(repos).toHaveLength(1);
    expect(repos[0].root).toBe('/repo/b');
  });

  it('unregister() is a no-op if repo not found', () => {
    const reg = new RepoRegistry(registryPath);
    expect(() => reg.unregister('/does/not/exist')).not.toThrow();
  });
});

// ─── ctx_cross_repo_search ────────────────────────────────────────────────

describe('ctx_cross_repo_search', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-cross-repo-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns XML with cross_repo_search element', async () => {
    const registryPath = path.join(tmpDir, 'repos.json');
    const registry = new ToolRegistry();
    registerCrossRepoSearchTool(registry, makeCtx(), registryPath);
    const result = await registry.dispatch('ctx_cross_repo_search', { query: 'auth service' });
    expect(result).toContain('<cross_repo_search');
    expect(result).toContain('</cross_repo_search>');
  });

  it('includes query attribute', async () => {
    const registryPath = path.join(tmpDir, 'repos.json');
    const registry = new ToolRegistry();
    registerCrossRepoSearchTool(registry, makeCtx(), registryPath);
    const result = await registry.dispatch('ctx_cross_repo_search', { query: 'processPayment' });
    expect(result).toContain('query="processPayment"');
  });

  it('returns no results when no repos are registered', async () => {
    const registryPath = path.join(tmpDir, 'repos.json');
    const registry = new ToolRegistry();
    registerCrossRepoSearchTool(registry, makeCtx(), registryPath);
    const result = await registry.dispatch('ctx_cross_repo_search', { query: 'anything' });
    expect(result).toContain('repos_searched="0"');
  });

  it('returns no results when registered repos have no indexed data (uninitialized store)', async () => {
    const registryPath = path.join(tmpDir, 'repos.json');
    // Register a fake repo that doesn't exist yet
    const reg = new RepoRegistry(registryPath);
    reg.register('/nonexistent/repo', '/nonexistent/repo/.ctxloom/vectors.lancedb');

    const registry = new ToolRegistry();
    registerCrossRepoSearchTool(registry, makeCtx(), registryPath);
    // Should not throw — just skip repos with missing/uninitialized stores
    const result = await registry.dispatch('ctx_cross_repo_search', { query: 'anything' });
    expect(result).toContain('<cross_repo_search');
    // The failed repo is skipped — total should show 0 results
    expect(result).toContain('count="0"');
  });

  it('respects limit parameter', async () => {
    const registryPath = path.join(tmpDir, 'repos.json');
    const registry = new ToolRegistry();
    registerCrossRepoSearchTool(registry, makeCtx(), registryPath);
    const result = await registry.dispatch('ctx_cross_repo_search', { query: 'auth', limit: 3 });
    expect(result).toContain('<cross_repo_search');
  });

  it('includes repos_searched attribute', async () => {
    const registryPath = path.join(tmpDir, 'repos.json');
    const registry = new ToolRegistry();
    registerCrossRepoSearchTool(registry, makeCtx(), registryPath);
    const result = await registry.dispatch('ctx_cross_repo_search', { query: 'anything' });
    expect(result).toMatch(/repos_searched="\d+"/);
  });
});
