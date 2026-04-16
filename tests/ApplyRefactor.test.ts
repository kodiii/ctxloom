import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerApplyRefactorTool } from '../src/tools/apply-refactor.js';
import type { ServerContext } from '../src/tools/context.js';

let tmpDir: string;

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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-refactor-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ctx_apply_refactor', () => {
  it('returns XML with apply_refactor element', async () => {
    const filePath = path.join(tmpDir, 'util.ts');
    fs.writeFileSync(filePath, 'export function oldName() {}\n');
    const graph = new DependencyGraph();
    graph.addSymbol('util.ts', { type: 'function', name: 'oldName', signature: 'function oldName()', startLine: 1, endLine: 1 });
    const registry = new ToolRegistry();
    registerApplyRefactorTool(registry, makeCtx(graph, tmpDir));
    const result = await registry.dispatch('ctx_apply_refactor', {
      symbol: 'oldName',
      new_name: 'newName',
    });
    expect(result).toContain('<apply_refactor');
    expect(result).toContain('</apply_refactor>');
  });

  it('rewrites occurrences in definition file', async () => {
    const filePath = path.join(tmpDir, 'util.ts');
    fs.writeFileSync(filePath, 'export function oldName() { return oldName; }\n');
    const graph = new DependencyGraph();
    graph.addSymbol('util.ts', { type: 'function', name: 'oldName', signature: 'function oldName()', startLine: 1, endLine: 1 });
    const registry = new ToolRegistry();
    registerApplyRefactorTool(registry, makeCtx(graph, tmpDir));
    await registry.dispatch('ctx_apply_refactor', {
      symbol: 'oldName',
      new_name: 'newName',
    });
    const after = fs.readFileSync(filePath, 'utf-8');
    expect(after).toContain('newName');
    expect(after).not.toContain('oldName');
  });

  it('dry_run=true does not write files', async () => {
    const filePath = path.join(tmpDir, 'util.ts');
    const original = 'export function oldName() {}\n';
    fs.writeFileSync(filePath, original);
    const graph = new DependencyGraph();
    graph.addSymbol('util.ts', { type: 'function', name: 'oldName', signature: 'function oldName()', startLine: 1, endLine: 1 });
    const registry = new ToolRegistry();
    registerApplyRefactorTool(registry, makeCtx(graph, tmpDir));
    await registry.dispatch('ctx_apply_refactor', {
      symbol: 'oldName',
      new_name: 'newName',
      dry_run: true,
    });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('reports total_files and total_occurrences', async () => {
    const filePath = path.join(tmpDir, 'util.ts');
    fs.writeFileSync(filePath, 'function oldName() {}\noldName();\n');
    const graph = new DependencyGraph();
    graph.addSymbol('util.ts', { type: 'function', name: 'oldName', signature: 'function oldName()', startLine: 1, endLine: 1 });
    const registry = new ToolRegistry();
    registerApplyRefactorTool(registry, makeCtx(graph, tmpDir));
    const result = await registry.dispatch('ctx_apply_refactor', {
      symbol: 'oldName',
      new_name: 'newName',
    });
    expect(result).toContain('total_files="1"');
    expect(result).toContain('total_occurrences="2"');
  });
});
