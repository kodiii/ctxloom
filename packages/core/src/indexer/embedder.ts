/**
 * Embedder — Generates vector embeddings using @huggingface/transformers.
 *
 * Uses the all-MiniLM-L6-v2 model (384 dimensions) for local,
 * fast, and privacy-preserving embedding generation.
 *
 * Corrected from @xenova/transformers per flaw analysis.
 */
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

// Heavy ML stack — defer the actual `import('@huggingface/transformers')`
// until the embedder is first loaded. Consumers that only need the
// dependency graph (e.g. apps/pr-bot) never trigger this, which keeps
// their bundle / container slim. The type import above is erased at
// compile time and adds no runtime cost.

const CHUNK_SIZE = 4096; // characters per chunk

/**
 * Registry of supported embedding models. Every entry MUST share these
 * properties for safe runtime swap-in:
 *
 *   - HuggingFace-hub identifier (transformers.js fetches by this name)
 *   - Output dimensionality (fixed per model; LanceDB table layout
 *     is shaped to this number at first-create time, so it cannot
 *     change without re-indexing)
 *   - `minBytes` for the truncated-download detector (each model has
 *     a different file size; MiniLM fp32 is ~90 MB, jina-code is ~140 MB)
 *
 * To add a new model: append an entry, validate it produces vectors of
 * the declared dimension, and document the size on disk so the
 * truncated-download recovery still works.
 */
interface EmbeddingModelConfig {
  readonly hfId: string;
  readonly dim: number;
  readonly minBytes: number;
  readonly description: string;
}

const MODEL_REGISTRY: Record<string, EmbeddingModelConfig> = {
  // The historical default. General English, 384-dim, ~90 MB.
  // Kept as the free-tier default so existing users see zero change.
  minilm: {
    hfId: 'sentence-transformers/all-MiniLM-L6-v2',
    dim: 384,
    minBytes: 80 * 1024 * 1024,
    description: 'General-purpose English sentence embedder (2020). 384-dim. The legacy default.',
  },
  // Code-specific embedding model (Jina AI). 768-dim, ~140 MB.
  // Empirically 20-40% better recall on code-similarity queries than
  // MiniLM — the upgrade path recommended in the v1.7.0 analysis.
  // Runs through the same @huggingface/transformers pipeline so the
  // privacy story (fully local, no network at inference time) is
  // preserved.
  'jina-code': {
    hfId: 'jinaai/jina-embeddings-v2-base-code',
    dim: 768,
    minBytes: 130 * 1024 * 1024,
    description: 'Code-specific embedder (Jina, 2024). 768-dim. Better recall on code-similarity tasks.',
  },
};

/**
 * Resolve the active embedding model from the environment.
 *
 * Accepted forms for `CTXLOOM_EMBEDDING_MODEL`:
 *   - A registry alias: `minilm` | `jina-code`
 *   - A raw HuggingFace ID (e.g. `BAAI/bge-small-en-v1.5`) — bypasses
 *     the registry; caller must also set `CTXLOOM_EMBEDDING_DIM` so the
 *     LanceDB schema knows the vector length to use
 *
 * Defaults to `minilm` for back-compat. Switching models on an existing
 * project requires re-indexing — see VectorStore's dimension-mismatch
 * guard.
 */
/**
 * Pure resolver: env-vars → active model config. Exported so unit tests
 * can exercise the registry/alias/raw-HF-id branches without polluting
 * `process.env` or reloading the module. The module-level `ACTIVE_MODEL`
 * binding captures the result at import time, so call sites that care
 * about runtime-stable behavior continue to see the same value for the
 * process lifetime.
 */
export function resolveEmbeddingModel(
  env: { CTXLOOM_EMBEDDING_MODEL?: string; CTXLOOM_EMBEDDING_DIM?: string } = process.env,
): EmbeddingModelConfig {
  const envModel = env.CTXLOOM_EMBEDDING_MODEL?.trim();
  if (!envModel) return MODEL_REGISTRY.minilm;

  const registered = MODEL_REGISTRY[envModel];
  if (registered) return registered;

  // Raw HF id — require explicit dim or refuse rather than guess.
  const envDim = env.CTXLOOM_EMBEDDING_DIM
    ? Number.parseInt(env.CTXLOOM_EMBEDDING_DIM, 10)
    : NaN;
  if (!Number.isFinite(envDim) || envDim <= 0) {
    throw new Error(
      `CTXLOOM_EMBEDDING_MODEL=${envModel} is not a known alias. ` +
      `Either use one of [${Object.keys(MODEL_REGISTRY).join(', ')}] ` +
      `or set CTXLOOM_EMBEDDING_DIM=<vector-length> alongside a raw HF id.`,
    );
  }
  return {
    hfId: envModel,
    dim: envDim,
    // Without a known artifact size we can't enforce the truncated-download
    // guard. Use 1 MB as the minimum; the worst case is a redundant retry
    // rather than a hung process.
    minBytes: 1024 * 1024,
    description: `User-supplied model: ${envModel} (${envDim}-dim)`,
  };
}

const ACTIVE_MODEL = resolveEmbeddingModel();
const EMBEDDING_DIMENSION = ACTIVE_MODEL.dim;
const MODEL_ID = ACTIVE_MODEL.hfId;
const MIN_MODEL_BYTES = ACTIVE_MODEL.minBytes;

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
  const { pipeline } = await import('@huggingface/transformers');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (pipeline as any)('feature-extraction', MODEL_ID, {
    dtype: 'fp32',
  })) as FeatureExtractionPipeline;
}

/**
 * Parse the model file path out of an onnxruntime protobuf-parse error.
 *
 * Stable message shape (onnxruntime 1.x):
 *   `Load model from <path> failed:Protobuf parsing failed.`
 *
 * Returns null if the message doesn't match — callers must treat the
 * absence of a path as "can't safely recover, fall through to backoff".
 */
function extractModelPathFromProtobufError(message: string): string | null {
  const match = /Load model from (.+) failed:Protobuf parsing failed/i.exec(message);
  return match ? match[1] : null;
}

/**
 * Delete a partially-downloaded model file so the next pipeline() call
 * triggers a fresh re-download. Best-effort — never throws; if the file
 * is gone (or was never there) the next attempt re-downloads anyway.
 *
 * Returns true if the file was actually truncated and removed, false if
 * either the file looks fine or we couldn't read/remove it.
 */
function tryRemoveTruncatedModel(modelPath: string): boolean {
  try {
    const stat = fs.statSync(modelPath);
    if (stat.size >= MIN_MODEL_BYTES) return false;
    fs.unlinkSync(modelPath);
    logger.warn('Removed truncated embedding model; next attempt will re-download', {
      path: modelPath,
      sizeBytes: stat.size,
      minBytes: MIN_MODEL_BYTES,
    });
    return true;
  } catch (err) {
    logger.warn('Could not inspect/remove suspected truncated model', {
      path: modelPath,
      detail: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
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

        // Distinguish "freshly-downloaded, not yet flushed" (transient FS
        // race — wait and retry against the same bytes) from "permanently
        // truncated" (download was killed mid-stream; bytes will NEVER
        // parse no matter how long we wait — we have to remove the file
        // so @huggingface/transformers re-fetches it). The size check is
        // the only signal we have without re-implementing the hub's
        // download flow.
        const modelPath = extractModelPathFromProtobufError(msg);
        if (modelPath && tryRemoveTruncatedModel(modelPath)) {
          // Skip the backoff sleep — file is gone, next attempt will go
          // straight to re-download.
          logger.warn('Retrying embedding model load after truncated-cache removal', {
            attempt,
          });
          continue;
        }

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
  //     full VS Code distribution; a vscode-extension app in any repo
  //     can drop one of these and pollute the index with vendored
  //     installer code).
  //     Discovered against ctxloom's own repo before the vscode-extension
  //     app was dropped: a single .vscode-test/Visual Studio Code.app/...
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

/**
 * Identifier of the currently-active embedding model. Used by
 * VectorStore to detect dimension-mismatch on table open (so a user
 * who flips CTXLOOM_EMBEDDING_MODEL on an existing project gets a
 * clear "re-index required" error rather than a silent type cast).
 */
export const EMBEDDING_MODEL_ID = MODEL_ID;

/**
 * Full active-model config (id, dim, description). Surfaced for
 * status/diagnostic tooling — `ctxloom status` includes this so users
 * can verify which model is in use.
 */
export function getActiveEmbeddingModel(): { hfId: string; dim: number; description: string } {
  return {
    hfId: ACTIVE_MODEL.hfId,
    dim: ACTIVE_MODEL.dim,
    description: ACTIVE_MODEL.description,
  };
}
