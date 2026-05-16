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

  describe('regression: graceful error handling on download failure', () => {
    /**
     * Closes the crash discovered during Phase B1 (PR #118 CI):
     *
     *   Error: ENOENT: no such file or directory, open
     *     '~/.ctxloom/grammars/wasm/tree-sitter-c-sharp.wasm.tmp'
     *
     * Root cause was two-fold:
     *   1. The C# manifest entry uses `wasm/tree-sitter-c-sharp.wasm` (subdir),
     *      but the loader only created `this.cacheDir` (root) — the WriteStream
     *      open ENOENT-failed on the missing `wasm/` directory.
     *   2. The WriteStream `'error'` listener was attached INSIDE the
     *      `https.get` callback, which fires far too late. Node's stream
     *      module treats an unhandled stream error as a process-fatal
     *      uncaughtException — bypassing the Promise rejection path entirely
     *      and killing the host process before the ASTParser try/catch
     *      around the await could catch it.
     *
     * These tests pin both fixes so a regression flips them red.
     */

    it('rejects (does NOT crash the process) when CDN is unreachable', async () => {
      // Force the loader to attempt a download by pointing the CDN at a port
      // that won't accept connections. Construct a fresh loader so the env
      // var is picked up.
      const prevCdn = process.env.CTXLOOM_GRAMMAR_CDN;
      process.env.CTXLOOM_GRAMMAR_CDN = 'https://127.0.0.1:1';
      try {
        const failingLoader = new GrammarLoader(cacheDir);
        // Any uncaughtException listener here proves the bug regressed.
        const uncaught: unknown[] = [];
        const onUncaught = (err: unknown) => uncaught.push(err);
        process.once('uncaughtException', onUncaught);

        await expect(failingLoader.ensureGrammar('csharp')).rejects.toThrow();

        // Give Node one extra tick so any straggler uncaughtException would surface.
        await new Promise((r) => setImmediate(r));
        process.off('uncaughtException', onUncaught);
        expect(uncaught, 'WriteStream error escaped as uncaughtException — Promise rejection path is broken').toEqual([]);

        // Bug-root pinning: the C# manifest entry is `wasm/tree-sitter-c-sharp.wasm`.
        // Before the fix, only `cacheDir` was created; `cacheDir/wasm/` was missing,
        // and the WriteStream open ENOENT'd. After the fix, the parent dir of
        // `dest` is mkdir'd recursively BEFORE the download attempt, so even on a
        // failed download the directory should exist.
        expect(fs.existsSync(path.join(cacheDir, 'wasm'))).toBe(true);
      } finally {
        if (prevCdn === undefined) delete process.env.CTXLOOM_GRAMMAR_CDN;
        else process.env.CTXLOOM_GRAMMAR_CDN = prevCdn;
      }
    });

    it('creates the wasmFile parent dir for subdir-pathed grammars', async () => {
      // The C# manifest entry has wasmFile: 'wasm/tree-sitter-c-sharp.wasm'.
      // Pre-seed it under the subdir to confirm getCachedPath resolves through
      // the subdir correctly (proves the path layout matches what download()
      // now mkdir's into).
      const wasmDir = path.join(cacheDir, 'wasm');
      fs.mkdirSync(wasmDir, { recursive: true });
      const wasmPath = path.join(wasmDir, 'tree-sitter-c-sharp.wasm');
      fs.writeFileSync(wasmPath, Buffer.alloc(100));
      expect(loader.getCachedPath('csharp')).toBe(wasmPath);
      expect(loader.isCached('csharp')).toBe(true);
    });
  });
});
