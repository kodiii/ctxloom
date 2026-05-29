/**
 * Regression test for the project_root / default-root mismatch bug in
 * the file-reading tools (ctx_full_text_search, ctx_refactor_preview,
 * ctx_apply_refactor).
 *
 * Bug: each tool loaded the graph for the PASSED project_root via
 * ctx.getGraph(project_root) — correct — but then read file contents
 * with path.join(ctx.projectRoot, relPath), where ctx.projectRoot is
 * the server's DEFAULT root. When the two diverge (every multi-project
 * / Claude-Desktop call passing an explicit project_root, or any
 * no-default server), the join produced a wrong absolute path, every
 * readFileSync failed, and ctx_full_text_search returned 0 results for
 * identifiers that plainly exist. Misdiagnosed in the field as a
 * "tokenizer drops leading-underscore identifiers" bug — there is no
 * tokenizer; keyword mode is a plain regex scan. It was a root mismatch.
 *
 * Fix: read from graph.getRootDir() — the exact root the graph was
 * built against — so the relpaths always line up.
 *
 * The original FullTextSearch.test.ts set ctx.projectRoot === graph
 * root, so default and passed root were always identical and the
 * divergence path was never exercised. This test forces divergence:
 * ctx.projectRoot points at an EMPTY decoy dir while the real source
 * lives elsewhere and the graph points at the real one.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerFullTextSearchTool } from '../src/tools/full-text-search.js';
import type { ServerContext } from '../src/tools/context.js';

/**
 * ctx whose default root (projectRoot) is a DECOY — deliberately not
 * the graph's root. getGraph always returns the real graph, mirroring
 * the server resolving an explicit project_root to the right graph.
 */
function makeDivergentCtx(graph: DependencyGraph, decoyRoot: string): ServerContext {
  return {
    projectRoot: decoyRoot,
    dbPath: path.join(decoyRoot, '.ctxloom/vectors.lancedb'),
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  } as unknown as ServerContext;
}

describe('ctx_full_text_search project_root resolution', () => {
  it('finds an identifier when the graph root differs from ctx.projectRoot', async () => {
    const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-real-'));
    const decoyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-decoy-'));
    try {
      // Leading-underscore identifier — the exact shape that "returned 0".
      fs.writeFileSync(
        path.join(realRoot, 'sizer.py'),
        'class PositionSizer:\n    def __init__(self):\n        self._min_position = 0.0\n',
      );
      const g = new DependencyGraph();
      await g.buildFromDirectory(realRoot);

      const registry = new ToolRegistry();
      registerFullTextSearchTool(registry, makeDivergentCtx(g, decoyRoot));

      const result = await registry.dispatch('ctx_full_text_search', {
        query: '_min_position',
        mode: 'keyword',
        project_root: realRoot,
      });

      // Pre-fix: count="0" (read from empty decoy). Post-fix: found.
      expect(result).toContain('sizer.py');
      expect(result).not.toContain('count="0"');
    } finally {
      fs.rmSync(realRoot, { recursive: true, force: true });
      fs.rmSync(decoyRoot, { recursive: true, force: true });
    }
  });

  it('finds a non-underscore identifier too (proves it was never a tokenizer issue)', async () => {
    const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-real-'));
    const decoyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-decoy-'));
    try {
      fs.writeFileSync(
        path.join(realRoot, 'sizer.py'),
        'def size(min_position_usd):\n    return min_position_usd\n',
      );
      const g = new DependencyGraph();
      await g.buildFromDirectory(realRoot);

      const registry = new ToolRegistry();
      registerFullTextSearchTool(registry, makeDivergentCtx(g, decoyRoot));

      const result = await registry.dispatch('ctx_full_text_search', {
        query: 'min_position_usd',
        mode: 'keyword',
        project_root: realRoot,
      });
      expect(result).toContain('sizer.py');
      expect(result).not.toContain('count="0"');
    } finally {
      fs.rmSync(realRoot, { recursive: true, force: true });
      fs.rmSync(decoyRoot, { recursive: true, force: true });
    }
  });

  it('still returns 0 for a genuinely absent term (no false positives)', async () => {
    const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-real-'));
    const decoyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-decoy-'));
    try {
      fs.writeFileSync(path.join(realRoot, 'sizer.py'), 'x = 1\n');
      const g = new DependencyGraph();
      await g.buildFromDirectory(realRoot);

      const registry = new ToolRegistry();
      registerFullTextSearchTool(registry, makeDivergentCtx(g, decoyRoot));

      const result = await registry.dispatch('ctx_full_text_search', {
        query: 'this_identifier_does_not_exist_anywhere',
        mode: 'keyword',
        project_root: realRoot,
      });
      expect(result).toContain('count="0"');
    } finally {
      fs.rmSync(realRoot, { recursive: true, force: true });
      fs.rmSync(decoyRoot, { recursive: true, force: true });
    }
  });
});
