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
import { generateEmbedding } from '../indexer/embedder.js';
import { VectorStore } from '../db/VectorStore.js';

async function run(): Promise<void> {
  const { filePath, content, root, dbPath } = workerData as {
    filePath: string;
    content: string;
    root: string;
    dbPath: string;
  };

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
