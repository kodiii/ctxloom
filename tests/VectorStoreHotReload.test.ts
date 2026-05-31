/**
 * Tests for VectorStore hot-reload (v1.7.8).
 *
 * Bug being fixed: a live MCP server pins one open LanceDB table handle.
 * When a terminal `ctxloom index` rewrites .ctxloom/vectors.lancedb on
 * the same path, the pinned handle keeps serving the OLD version — so
 * ctx_search / ctx_similar_files return stale or empty results until the
 * MCP client restarts. (The vector analogue of the graph snapshot
 * hot-reload shipped in v1.7.5 / PR #256.)
 *
 * Fix: before each read, VectorStore stats the LanceDB `_versions` dir
 * mtime; if it advanced past the last write WE made, an external writer
 * touched the store → checkoutLatest() re-points the handle. The mtime
 * gate keeps idle reads free AND prevents the server's own continuous
 * upserts from triggering a refresh storm.
 *
 * Empirically verified (probe against @lancedb/lancedb 0.27.x): a
 * second connection's add() is INVISIBLE to a pinned handle until
 * checkoutLatest() is called — countRows stays stale, then jumps after
 * refresh. This test pins that VectorStore now does that refresh
 * automatically.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorStore } from '../src/db/VectorStore.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIM = 384;
function vec(seed: number): number[] {
  // Deterministic non-zero vector so vectorSearch returns the row.
  return new Array(DIM).fill(0).map((_, i) => ((seed * 31 + i) % 97) / 97 + 0.01);
}

describe('VectorStore hot-reload', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-hotreload-'));
    dbPath = path.join(tempDir, 'vectors.lancedb');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('picks up an external rewrite on the next read without re-init', async () => {
    // "Live MCP server" handle.
    const server = new VectorStore(dbPath);
    await server.init();
    await server.upsert('a.ts', vec(1), 'alpha');
    expect(await server.count()).toBe(1);

    // "Terminal ctxloom index" — a SEPARATE VectorStore on the SAME path
    // that adds more records. Mirrors the real two-process scenario.
    const terminal = new VectorStore(dbPath);
    await terminal.init();
    await terminal.upsert('b.ts', vec(2), 'beta');
    await terminal.upsert('c.ts', vec(3), 'gamma');
    await terminal.close();

    // Ensure the _versions dir mtime is strictly newer than the
    // server's last write (some filesystems have coarse mtime
    // resolution; nudge it forward deterministically).
    const versionsDir = path.join(dbPath, 'code_embeddings.lance', '_versions');
    const future = Date.now() / 1000 + 5;
    try { fs.utimesSync(versionsDir, future, future); } catch { /* best-effort */ }

    // The server's pinned handle must now see the terminal's writes —
    // WITHOUT the server calling init()/close() again.
    expect(await server.count()).toBe(3);
    expect(server.getExternalRefreshCount()).toBeGreaterThan(0);

    await server.close();
  });

  it('does NOT refresh on the server\'s own writes (no thrash)', async () => {
    const server = new VectorStore(dbPath);
    await server.init();

    // A burst of the server's own upserts + interleaved reads — exactly
    // what incremental file-watch indexing does. None of these are
    // external, so the external-refresh counter must stay at 0.
    for (let i = 0; i < 5; i++) {
      await server.upsert(`f${i}.ts`, vec(i + 10), `body ${i}`);
      await server.count();
      await server.search(vec(i + 10), 3);
    }

    expect(server.getExternalRefreshCount()).toBe(0);
    expect(await server.count()).toBe(5);

    await server.close();
  });

  it('search() reflects external rows after refresh', async () => {
    const server = new VectorStore(dbPath);
    await server.init();
    await server.upsert('only-local.ts', vec(1), 'local');

    const terminal = new VectorStore(dbPath);
    await terminal.init();
    await terminal.upsert('external-1.ts', vec(2), 'ext one');
    await terminal.upsert('external-2.ts', vec(3), 'ext two');
    await terminal.close();

    const versionsDir = path.join(dbPath, 'code_embeddings.lance', '_versions');
    const future = Date.now() / 1000 + 5;
    try { fs.utimesSync(versionsDir, future, future); } catch { /* best-effort */ }

    // A search after the external rewrite should be able to surface the
    // externally-added files (proves the handle re-pointed, not just
    // countRows).
    const results = await server.search(vec(2), 10);
    const paths = results.map(r => r.filePath);
    expect(paths).toContain('external-1.ts');

    await server.close();
  });
});
