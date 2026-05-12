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
let embedderInitInFlight: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Initialize the embedding pipeline. Called lazily on first use.
 *
 * Concurrency: a singleton in-flight promise so concurrent first-call
 * requests don't kick off N parallel ONNX-model loads, each opening
 * the same .onnx file (the protobuf-parse-failed race in v1.0.9).
 *
 * Retry: on a fresh install, @huggingface/transformers downloads the
 * 90 MB model file lazily. The OS may not have flushed its page cache
 * by the time onnxruntime opens the file — protobuf parse hits a
 * partial header and throws "Protobuf parsing failed". The file ends
 * up correctly written; a single retry after a short delay catches
 * the race without papering over genuine corruption.
 */
async function loadEmbedder(): Promise<FeatureExtractionPipeline> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (pipeline as any)('feature-extraction', MODEL_ID, {
    dtype: 'fp32',
  })) as FeatureExtractionPipeline;
}

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder;
  if (embedderInitInFlight) return embedderInitInFlight;

  embedderInitInFlight = (async () => {
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const pipe = await loadEmbedder();
        embedder = pipe;
        return pipe;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isProtobufRace = /protobuf parsing failed/i.test(msg);
        if (!isProtobufRace || attempt === MAX_ATTEMPTS) break;
        // Exponential backoff: 1s, 2s — gives the OS time to fsync the
        // freshly-downloaded model bytes before onnxruntime re-opens.
        const delay = attempt * 1000;
        logger.warn('Embedding model load failed; retrying after FS settle', {
          attempt,
          delayMs: delay,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    embedderInitInFlight = null;
    throw lastErr;
  })();

  try {
    return await embedderInitInFlight;
  } finally {
    if (embedder) embedderInitInFlight = null;
  }
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
  // Default ignore list. Anything in here is skipped at any depth in the
  // tree. Three buckets of stuff we never want to embed:
  //
  //   - Build artifacts and caches that explode the index without adding
  //     signal (node_modules, dist, build, coverage, .next, .nuxt, out,
  //     .cache, .turbo, target — the last is Rust).
  //   - State directories owned by other tools that frequently contain
  //     duplicated copies of the user's source (.claude with its
  //     worktrees/, .code-review-graph with its own snapshots) or
  //     thousands of unrelated installer files (.vscode-test bundles the
  //     full VS Code distribution under apps/vscode-extension/).
  //     Discovered against ctxloom's own repo: a single
  //     `apps/vscode-extension/.vscode-test/Visual Studio Code.app/...`
  //     tree polluted execution-flow output with calls into
  //     ms-vscode.js-debug, and `.claude/worktrees/*` produced five
  //     identical copies of every large function in find-large-functions.
  //   - The ctxloom-owned `.ctxloom` directory itself — we never embed
  //     our own snapshots back into the index.
  const IGNORED_DIRS = new Set([
    // Build artifacts + dependency caches
    'node_modules', 'dist', 'build', 'out', 'target',
    'coverage', '.cache', '.turbo', '.next', '.nuxt',
    // Version control + ctxloom state
    '.git', '.ctxloom',
    // Other tools' working state (often contains duplicated source)
    '.claude', '.code-review-graph', '.vscode-test',
  ]);

  const SUPPORTED_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue',
    '.py', '.rs', '.go', '.java', '.cs', '.rb', '.kt', '.kts', '.swift', '.php', '.dart',
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

  // Wrap the actual indexing in try/finally so we always release LanceDB
  // resources before returning — see store.close() for the FD-exhaustion
  // rationale. Without this, every WASM/ONNX loader called after indexing
  // (e.g. ASTParser.init() in the dependency-graph phase) can hit ENFILE
  // when running under macOS's 256-FD default in processes spawned by
  // Claude / VS Code.
  try {
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
  } finally {
    await store.close();
  }

  return { indexed, errors };
}

export { EMBEDDING_DIMENSION };
