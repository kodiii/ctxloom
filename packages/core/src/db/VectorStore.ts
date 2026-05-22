/**
 * VectorStore — LanceDB-backed vector storage for code embeddings.
 *
 * Uses @lancedb/lancedb (corrected package per flaw analysis).
 * Schema: id (string), filePath (string), embedding (Float32[]), content (string)
 */
// LanceDB is heavy (~150 MB across platform-specific native binaries).
// Consumers that only need the dependency graph (e.g. apps/pr-bot) never
// instantiate a VectorStore, so defer the `import('@lancedb/lancedb')`
// until `.init()` is called. Type imports are erased at compile time and
// don't trigger runtime resolution.
import type { Connection, Table } from '@lancedb/lancedb';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../utils/logger.js';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL_ID } from '../indexer/embedder.js';

export interface VectorSearchResult {
  filePath: string;
  content: string;
  score: number;
}

/**
 * Shape of the return value of LanceDB's `Table.optimize()`.
 * Documented at https://lancedb.github.io/lancedb/ — kept local so the
 * TS compiler can validate the shape even on older `@lancedb/lancedb`
 * builds that don't yet export this type.
 */
interface OptimizeResult {
  compaction?: {
    fragmentsRemoved?: number;
    fragmentsAdded?: number;
    filesRemoved?: number;
    filesAdded?: number;
  };
  prune?: {
    bytesRemoved?: number;
    oldVersionsRemoved?: number;
  };
}

/**
 * Sanitize a file path for use in LanceDB filter strings.
 * Allows only characters that appear in normal file paths.
 */
function sanitizeFilterPath(filePath: string): string {
  // Replace any character that isn't alphanumeric, slash, dot, underscore, hyphen, or space
  // with an underscore to prevent filter injection
  return filePath.replace(/[^a-zA-Z0-9/._\- ]/g, '_');
}

export interface VectorStoreOptions {
  /**
   * How many upserts must occur before automatic compaction fires.
   * Defaults to 200. Set lower in tests to exercise the compaction path
   * with shorter run times.
   */
  compactEvery?: number;
  /**
   * Maximum age (in ms) of LanceDB versions to retain when compaction
   * runs. Older transaction + manifest files are pruned. Defaults to
   * 1 hour, which is long enough for crash recovery / debugging on a
   * production MCP server while still releasing the bulk of file
   * descriptors. Tests can pass a small value (e.g. 0) to verify the
   * cleanup path actually prunes.
   */
  cleanupOlderThanMs?: number;
}

export class VectorStore {
  private dbPath: string;
  private db: Connection | null = null;
  private table: Table | null = null;
  private initialized = false;
  /**
   * Upserts since the last compaction. LanceDB writes 2 transactions per
   * upsert (delete + add); without periodic compact_files() + cleanup, a
   * long-lived MCP server accumulates tens of thousands of fragment FDs
   * (observed: ~60k FDs / process after 18h of watcher-driven reindex).
   */
  private upsertsSinceCompact = 0;
  private readonly compactEvery: number;
  private readonly cleanupOlderThanMs: number;

  constructor(dbPath?: string, options: VectorStoreOptions = {}) {
    this.dbPath = dbPath ?? path.join(process.cwd(), '.ctxloom', 'vectors.lancedb');
    this.compactEvery = options.compactEvery ?? 200;
    this.cleanupOlderThanMs = options.cleanupOlderThanMs ?? 60 * 60 * 1000;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Lazy: only consumers that actually open a vector store pay the
    // cost of loading LanceDB's platform-specific native binding.
    //
    // ESM/CJS interop: under vitest the dynamic import resolves to a
    // module with a `default` property; under `npx tsx` (used by the
    // bench harness) it resolves to a namespace object where `connect`
    // is a direct property. Handle both shapes so the same VectorStore
    // class works in tests + bench + production.
    const lancedb = await import('@lancedb/lancedb');
    const lanceModule = (lancedb as { default?: unknown }).default ?? lancedb;
    const lance = lanceModule as {
      connect: (p: string) => Promise<Connection>;
    };
    const { makeArrowTable } = lancedb;

    this.db = await lance.connect(this.dbPath);

    // ── Embedding-model marker file ─────────────────────────────────
    // The LanceDB table is shaped to the embedding dimension at
    // first-create time and cannot change without a destructive
    // rebuild. Without a guard, a user who flips
    // CTXLOOM_EMBEDDING_MODEL on an existing project gets a confusing
    // type/cast error at upsert time AFTER the model has loaded — and
    // worse, partially-mixed-dimension rows are unrecoverable.
    //
    // Solution: write a tiny marker file next to the LanceDB dir
    // recording the model that built the index. On open we compare
    // to the active model. Mismatch → fail-fast with a clear error
    // telling the user to wipe + re-index. Legacy indexes without
    // a marker (built before this commit) are assumed to be MiniLM
    // (the only model that existed at the time) and the marker is
    // written so subsequent runs are guarded.
    const markerPath = path.join(path.dirname(this.dbPath), 'embedding-model.json');
    this.assertModelCompatibility(markerPath);

    // Create or open table
    const existingTables = await this.db.tableNames();
    if (existingTables.includes('code_embeddings')) {
      this.table = await this.db.openTable('code_embeddings');
    } else {
      // Create with a seed record using arrow table format. Vector
      // length is the ACTIVE model's dim (not hard-coded 384) so the
      // table layout matches whatever embedder the user picked.
      const seedTable = makeArrowTable([
        {
          id: '__seed__',
          filePath: '__seed__',
          vector: new Array(EMBEDDING_DIMENSION).fill(0),
          content: '',
        },
      ]);
      this.table = await this.db.createTable('code_embeddings', seedTable);
      // Remove seed record
      await this.table.delete("id = '__seed__'");
    }

    this.initialized = true;
  }

  /**
   * Compare the active embedding model against the marker file written
   * when the index was first built. Three cases:
   *
   *   1. Marker missing  → legacy index (pre-v1.7.0). Assume MiniLM
   *      and write the marker so future runs are guarded.
   *   2. Marker matches  → proceed silently.
   *   3. Marker differs  → throw with a clear migration instruction.
   *      We don't auto-wipe — silently dropping a user's index because
   *      they set an env var is exactly the footgun the marker exists
   *      to prevent.
   */
  private assertModelCompatibility(markerPath: string): void {
    const active = { model: EMBEDDING_MODEL_ID, dim: EMBEDDING_DIMENSION };

    let existing: { model?: unknown; dim?: unknown } | null = null;
    if (fs.existsSync(markerPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      } catch (err) {
        logger.warn('Embedding-model marker is corrupt; treating as missing', {
          path: markerPath,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!existing) {
      // Legacy index OR fresh install — write the marker and proceed.
      fs.writeFileSync(markerPath, JSON.stringify(active, null, 2));
      return;
    }

    if (existing.model === active.model && existing.dim === active.dim) {
      return; // happy path
    }

    throw new Error(
      `Embedding-model mismatch: vector index at ${this.dbPath} was built ` +
      `with "${existing.model}" (${existing.dim}-dim) but the active model is ` +
      `"${active.model}" (${active.dim}-dim). Re-index required:\n\n` +
      `    ctxloom vectors-cleanup --reset\n` +
      `    ctxloom index\n\n` +
      `Or revert CTXLOOM_EMBEDDING_MODEL to "${existing.model}" to keep the existing index.`,
    );
  }

  /**
   * Release LanceDB resources (file descriptors held by the underlying
   * connection / table handles). Must be called at the end of long-lived
   * indexing runs — without this, every SSTable opened during 600+ upserts
   * stays open until process exit, which can exhaust the per-process FD
   * limit (256 on macOS by default for processes spawned by Claude /
   * VS Code) and cause downstream loaders (tree-sitter WASM, ONNX models)
   * to fail with ENFILE.
   *
   * Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (!this.initialized) return;
    try {
      // LanceDB Connection has a close() method on newer versions; older
      // versions need explicit table drop. Try close first, fall back to
      // detaching references so GC can run.
      const conn = this.db as Connection & { close?: () => Promise<void> };
      if (typeof conn.close === 'function') {
        await conn.close();
      }
    } catch {
      // Best-effort — never throw from close()
    }
    this.db = null;
    this.table = null;
    this.initialized = false;
  }

  /**
   * Insert or update a code record.
   */
  async upsert(filePath: string, embedding: number[], content: string): Promise<void> {
    if (!this.table) throw new Error('VectorStore not initialized. Call init() first.');

    // Delete existing record for this file
    const safe = sanitizeFilterPath(filePath);
    try {
      await this.table.delete(`filePath = '${safe}'`);
    } catch (err) {
      logger.warn('Delete before upsert failed, continuing', { detail: err instanceof Error ? err.message : String(err) });
    }

    // Insert new record
    const record = {
      id: filePath,
      filePath,
      vector: embedding,
      content: content.slice(0, 512),
    };

    await this.table.add([record]);

    this.upsertsSinceCompact++;
    if (this.upsertsSinceCompact >= this.compactEvery) {
      this.upsertsSinceCompact = 0;
      await this.compact();
    }
  }

  /**
   * Merge fragments and prune old LanceDB versions. Idempotent and safe to
   * call mid-flight; the Table API serializes writes internally. Called
   * automatically every `compactEvery` upserts (default 200) to bound FD
   * growth in long-lived MCP server processes.
   *
   * Uses optional-chaining so older `@lancedb/lancedb` builds without
   * `optimize()` degrade to a no-op instead of crashing.
   */
  async compact(): Promise<void> {
    if (!this.table) return;
    try {
      const optimizable = this.table as Table & {
        optimize?: (opts?: { cleanupOlderThan?: Date }) => Promise<OptimizeResult | void>;
      };
      // Cleanup window is configurable — defaults to 1h, which keeps a
      // crash-recovery buffer in production while still releasing the
      // bulk of stale fragment / manifest / transaction FDs.
      const result = await optimizable.optimize?.({
        cleanupOlderThan: new Date(Date.now() - this.cleanupOlderThanMs),
      });
      // Log the outcome so production telemetry can confirm whether
      // cleanup is actually pruning. If `oldVersionsRemoved` stays 0
      // across many compactions, LanceDB is refusing to delete versions
      // (likely live-mmap conflict) and we need an out-of-process
      // cleanup path — see `ctxloom vectors-cleanup` CLI.
      if (result) {
        logger.info('VectorStore.compact', {
          fragmentsRemoved: result.compaction?.fragmentsRemoved ?? 0,
          fragmentsAdded: result.compaction?.fragmentsAdded ?? 0,
          oldVersionsRemoved: result.prune?.oldVersionsRemoved ?? 0,
          bytesRemoved: result.prune?.bytesRemoved ?? 0,
        });
      }
    } catch (err) {
      logger.warn('VectorStore.compact failed (non-fatal)', {
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Retrieve the stored embedding for a known file. Returns null if the
   * file isn't indexed. Used by blast-radius semantic-similarity search
   * (v1.6.x) to find files semantically related to a seed without
   * re-embedding the seed at query time.
   */
  async findEmbeddingByPath(filePath: string): Promise<number[] | null> {
    if (!this.table) throw new Error('VectorStore not initialized. Call init() first.');

    try {
      const safe = sanitizeFilterPath(filePath);
      // LanceDB Table.query() returns a builder. We filter by exact
      // filePath match and limit to one row.
      const rows = await this.table
        .query()
        .where(`filePath = '${safe}'`)
        .limit(1)
        .toArray();
      const first = rows[0] as Record<string, unknown> | undefined;
      if (!first) return null;
      // The vector column is named `vector` per the schema in init().
      // LanceDB returns it as a Float32Array or number[]; normalize to
      // number[] so downstream search() accepts it.
      const vec = first.vector;
      if (vec === null || vec === undefined) return null;
      if (Array.isArray(vec)) return vec as number[];
      if (vec instanceof Float32Array) return Array.from(vec);
      // Some bindings return as a typed array — try a permissive coerce.
      if (typeof (vec as { length?: number }).length === 'number') {
        return Array.from(vec as ArrayLike<number>);
      }
      return null;
    } catch (err) {
      logger.warn('VectorStore.findEmbeddingByPath failed', {
        detail: err instanceof Error ? err.message : String(err),
        filePath,
      });
      return null;
    }
  }

  /**
   * Search for the top-K most similar code records using vector search.
   */
  async search(queryEmbedding: number[], limit: number = 10): Promise<VectorSearchResult[]> {
    if (!this.table) throw new Error('VectorStore not initialized. Call init() first.');

    try {
      const results = await this.table
        .vectorSearch(queryEmbedding)
        .limit(limit)
        .toArray();

      return results
        .filter((r: Record<string, unknown>) => r.id !== '__seed__')
        .map((r: Record<string, unknown>) => ({
          filePath: String(r.filePath ?? r.id),
          content: String(r.content ?? ''),
          score: Number(r._distance ?? 0),
        }));
    } catch (err) {
      // If vector index doesn't exist yet, try creating it
      logger.warn('Search failed, attempting to create index', { detail: String(err) });
      try {
        await this.table.createIndex('vector');
        const results = await this.table
          .vectorSearch(queryEmbedding)
          .limit(limit)
          .toArray();

        return results
          .filter((r: Record<string, unknown>) => r.id !== '__seed__')
          .map((r: Record<string, unknown>) => ({
            filePath: String(r.filePath ?? r.id),
            content: String(r.content ?? ''),
            score: Number(r._distance ?? 0),
          }));
      } catch {
        return [];
      }
    }
  }

  /**
   * Remove a file's embedding from the store.
   */
  async remove(filePath: string): Promise<void> {
    if (!this.table) throw new Error('VectorStore not initialized. Call init() first.');

    const safe = sanitizeFilterPath(filePath);
    try {
      await this.table.delete(`filePath = '${safe}'`);
    } catch (err) {
      logger.error('Remove failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Get the total number of records.
   */
  async count(): Promise<number> {
    if (!this.table) return 0;
    try {
      return await this.table.countRows();
    } catch (err) {
      logger.error('countRows failed', { detail: err instanceof Error ? err.message : String(err) });
      return 0;
    }
  }
}
