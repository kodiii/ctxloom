/**
 * indexerWorker.ts — Runs in a worker_threads Worker.
 *
 * Receives workerData: { filePath, content, root, dbPath }
 * Posts back:          { status: 'success' | 'error', path?, error? }
 *
 * Performs embedding generation + LanceDB upsert without blocking
 * the main MCP server thread.
 */
import { parentPort, workerData } from 'worker_threads';
import path from 'node:path';
import { z } from 'zod';
import { generateEmbedding } from '../indexer/embedder.js';
import { VectorStore } from '../db/VectorStore.js';

// M-3 (audit): workerData was previously cast with `as { ... }` — no
// runtime validation. Worker spawning is internal trusted code today,
// but a future regression that passes the wrong shape (or untrusted
// content) would silently corrupt the index instead of failing fast.
// Zod parse here is the cheapest way to make the contract explicit.
const WorkerDataSchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
  root: z.string().min(1),
  dbPath: z.string().min(1),
});

async function run(): Promise<void> {
  const parsed = WorkerDataSchema.safeParse(workerData);
  if (!parsed.success) {
    parentPort?.postMessage({
      status: 'error',
      error: `invalid workerData: ${parsed.error.message}`,
    });
    return;
  }
  const { filePath, content, root, dbPath } = parsed.data;

  let store: VectorStore | null = null;
  try {
    const relPath = path.relative(root, filePath);

    store = new VectorStore(dbPath);
    await store.init();

    const embedding = await generateEmbedding(content.slice(0, 4096));
    await store.upsert(relPath, embedding, content.slice(0, 512));

    parentPort?.postMessage({ status: 'success', path: relPath });
  } catch (err) {
    parentPort?.postMessage({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    // Close in the worker too — short-lived processes get GC'd eventually,
    // but explicit close prevents FD pressure when many workers spawn in
    // quick succession (e.g. file-watcher re-indexing).
    if (store) await store.close();
  }
}

run();
