import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerFullTextSearchTool } from '../src/tools/full-text-search.js';
import type { ServerContext } from '../src/tools/context.js';

function makeCtx(graph: DependencyGraph, root: string): ServerContext {
  return {
    projectRoot: root,
    dbPath: path.join(root, '.ctxloom/vectors.lancedb'),
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  };
}

describe('ctx_full_text_search', () => {
  it('returns XML with full_text_search element', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'function authenticate() {}');
      const g = new DependencyGraph();
      g.addEdge('a.ts', 'b.ts');
      const registry = new ToolRegistry();
      registerFullTextSearchTool(registry, makeCtx(g, tmpDir));
      const result = await registry.dispatch('ctx_full_text_search', {
        query: 'authenticate',
        mode: 'keyword',
      });
      expect(result).toContain('<full_text_search');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds files containing the exact query term', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'auth.ts'), 'export function authenticate() {}');
      fs.writeFileSync(path.join(tmpDir, 'other.ts'), 'export function unrelated() {}');
      const g = new DependencyGraph();
      g.addEdge('auth.ts', 'other.ts');
      const registry = new ToolRegistry();
      registerFullTextSearchTool(registry, makeCtx(g, tmpDir));
      const result = await registry.dispatch('ctx_full_text_search', {
        query: 'authenticate',
        mode: 'keyword',
      });
      expect(result).toContain('auth.ts');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty result when nothing matches', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export const x = 1;');
      const g = new DependencyGraph();
      g.addEdge('a.ts', 'b.ts');
      const registry = new ToolRegistry();
      registerFullTextSearchTool(registry, makeCtx(g, tmpDir));
      const result = await registry.dispatch('ctx_full_text_search', {
        query: 'zzzNOTFOUNDzzz',
        mode: 'keyword',
      });
      expect(result).toContain('count="0"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('respects case_sensitive=true vs false', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export function MyFunc() {}');
      const g = new DependencyGraph();
      g.addEdge('a.ts', 'b.ts');
      const registry = new ToolRegistry();
      registerFullTextSearchTool(registry, makeCtx(g, tmpDir));
      const sensitive = await registry.dispatch('ctx_full_text_search', {
        query: 'myfunc',
        mode: 'keyword',
        case_sensitive: true,
      });
      expect(sensitive).toContain('count="0"');
      const insensitive = await registry.dispatch('ctx_full_text_search', {
        query: 'myfunc',
        mode: 'keyword',
        case_sensitive: false,
      });
      expect(insensitive).toContain('a.ts');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
