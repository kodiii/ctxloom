import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GrammarLoader } from '../src/grammars/GrammarLoader.js';

describe('GrammarLoader', () => {
  let cacheDir: string;
  let loader: GrammarLoader;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-grammar-test-'));
    loader = new GrammarLoader(cacheDir);
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('lists all known grammars with their status', () => {
    const list = loader.listGrammars();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toMatchObject({ language: expect.any(String), status: 'missing' });
  });

  it('returns cached path if grammar file exists', async () => {
    // Pre-seed the cache
    const wasmPath = path.join(cacheDir, 'tree-sitter-python.wasm');
    fs.writeFileSync(wasmPath, Buffer.alloc(100)); // fake wasm
    const cachedPath = loader.getCachedPath('python');
    expect(cachedPath).toBe(wasmPath);
    expect(loader.isCached('python')).toBe(true);
  });

  it('returns null for uncached grammar', () => {
    expect(loader.getCachedPath('python')).toBeNull();
    expect(loader.isCached('python')).toBe(false);
  });

  it('throws for unknown language', async () => {
    await expect(loader.ensureGrammar('nonexistent_lang')).rejects.toThrow('Unknown grammar');
  });
});
