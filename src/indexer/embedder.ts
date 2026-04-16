/**
 * Embedder — Generates vector embeddings using @huggingface/transformers.
 *
 * Uses the all-MiniLM-L6-v2 model (384 dimensions) for local,
 * fast, and privacy-preserving embedding generation.
 *
 * Corrected from @xenova/transformers per flaw analysis.
 */
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

const EMBEDDING_DIMENSION = 384;
const MODEL_ID = 'sentence-transformers/all-MiniLM-L6-v2';
const CHUNK_SIZE = 4096; // characters per chunk

let embedder: FeatureExtractionPipeline | null = null;

/**
 * Initialize the embedding pipeline. Called lazily on first use.
 */
async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'fp32',
    });
  }
  return embedder;
}

/**
 * Generate a 384-dimensional embedding for the given text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const pipe = await getEmbedder();
  const output = await pipe(text.slice(0, CHUNK_SIZE), {
    pooling: 'mean',
    normalize: true,
  });

  // Convert tensor to plain array
  const data = output.tolist();
  if (Array.isArray(data[0])) {
    return data[0] as number[];
  }
  return data as number[];
}

/**
 * Collect all supported source files from a directory.
 * Respects common ignore patterns.
 */
export function collectFiles(dir: string, results: string[] = []): string[] {
  const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.ctxloom',
    'coverage', '.next', '.nuxt', 'out', '.cache', '.turbo',
  ]);

  const SUPPORTED_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs',
    '.py', '.rs', '.go', '.java', '.cs', '.rb', '.kt', '.kts', '.swift',
    '.c', '.cpp', '.h',
    '.md', '.json', '.yaml', '.yml', '.toml',
    '.ipynb',
  ]);

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        collectFiles(fullPath, results);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Index an entire directory: chunk files and store embeddings.
 * Processes up to CONCURRENCY files simultaneously for better throughput.
 */
export async function indexDirectory(
  rootDir: string,
  onProgress?: (file: string, index: number, total: number) => void,
): Promise<{ indexed: number; errors: number }> {
  const { VectorStore } = await import('../db/VectorStore.js');
  const store = new VectorStore(path.join(rootDir, '.ctxloom', 'vectors.lancedb'));
  await store.init();

  const files = collectFiles(rootDir);
  const total = files.length;
  let indexed = 0;
  let errors = 0;
  let processed = 0;

  const CONCURRENCY = 4;

  // Process files in fixed-size batches for controlled parallelism
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (filePath) => {
        // H-3: Guard against enormous files before reading into memory
        const MAX_INDEX_SIZE = 5 * 1024 * 1024; // 5 MB
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_INDEX_SIZE) {
          logger.warn('Skipping oversized file', { file: filePath, size: stat.size });
          return null;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.trim()) return null;

        const relPath = path.relative(rootDir, filePath);
        const embedding = await generateEmbedding(content);
        await store.upsert(relPath, embedding, content);
        return relPath;
      }),
    );

    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled') {
        if (result.value !== null) {
          indexed++;
          onProgress?.(result.value, processed, total);
        }
      } else {
        errors++;
        logger.error('Failed to index file', { detail: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      }
    }
  }

  return { indexed, errors };
}

export { EMBEDDING_DIMENSION };
