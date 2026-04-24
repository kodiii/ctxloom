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

  try {
    const relPath = path.relative(root, filePath);

    const store = new VectorStore(dbPath);
    await store.init();

    const embedding = await generateEmbedding(content.slice(0, 4096));
    await store.upsert(relPath, embedding, content.slice(0, 512));

    parentPort?.postMessage({ status: 'success', path: relPath });
  } catch (err) {
    parentPort?.postMessage({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

run();
