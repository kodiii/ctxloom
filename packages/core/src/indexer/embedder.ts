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
 * Generate an embedding vector for the given text. The dimension is
 * model-dependent (384 for MiniLM, 768 for jina-code, etc. — see
 * `EMBEDDING_DIMENSION` for the active model).
 *
 * Single-text API. Prefer `generateEmbeddingBatch` when embedding N>1
 * texts at once — ONNX runtime amortizes session overhead across the
 * batch and delivers 3–10× throughput on multi-file indexing workloads.
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
 * Generate embedding vectors for N texts in a SINGLE ONNX inference
 * call. Throughput on the indexer's hot path is dominated by ONNX
 * runtime session overhead — each `pipe(text, ...)` call sets up a
 * graph execution context, copies inputs to runtime memory, runs the
 * forward pass, and copies outputs back. Batching amortizes that
 * overhead across N texts.
 *
 * Measured on M-series Mac (jina-code, 768-dim) with the v1.7.0 bench
 * corpus (15 worktrees, ~5k files total):
 *
 *   Per-file calls:   ~12 ms/file → ~60 s wall time
 *   Batch of 50:       ~2 ms/file → ~10 s wall time   (~6× speedup)
 *
 * Returns vectors in the SAME ORDER as the input texts (the transformers.js
 * pipeline preserves order — the tensor row index === input position).
 *
 * Each text is sliced to CHUNK_SIZE before tokenization, matching the
 * single-text API exactly. This is critical: the bench's existing
 * symbol/import coverage numbers were measured against CHUNK_SIZE-
 * truncated embeddings, and we MUST NOT silently change the input
 * shape when switching to batch mode (would invalidate prior results).
 *
 * Empty input is a no-op (returns []). Callers can safely pass a
 * possibly-empty batch without a guard.
 */
export async function generateEmbeddingBatch(
  texts: readonly string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const pipe = await getEmbedder();
  const truncated = texts.map((t) => t.slice(0, CHUNK_SIZE));
  // transformers.js accepts string[] as input and returns a tensor
  // shaped [batch_size, embedding_dim]. The single-string call path
  // gets a [1, embedding_dim] tensor that we unwrap; for the batch
  // case we want the full N rows.
  const output = await pipe(truncated, {
    pooling: 'mean',
    normalize: true,
  });

  const data = output.tolist();
  // Defensive shape check: the pipeline ALWAYS returns a 2D array for
  // multi-input invocation per transformers.js docs, but we don't want
  // a silent corruption if a future runtime upgrade changes the
  // contract. A 1D return on multi-input would be a bug — fail loud.
  if (!Array.isArray(data[0])) {
    throw new Error(
      `generateEmbeddingBatch: pipeline returned 1D tensor for ${texts.length} inputs ` +
      '(expected 2D [batch_size, embedding_dim]). Likely a transformers.js version regression.',
    );
  }
  return data as number[][];
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
 * Streaming file walker — async generator over supported source files.
 *
 * Why streaming vs the materialized `collectFiles`: on 50k+ file repos
 * (Next.js, the Linux kernel, large monorepos) the upfront discovery
 * pass takes 5–15 seconds during which the user sees zero progress AND
 * we hold every absolute path in memory at once. The streaming variant
 * yields each file the moment it's discovered, lets the indexer start
 * processing in parallel with the walk, and keeps memory pressure flat.
 *
 * Ignore rules and supported extensions are kept identical to the
 * sync `collectFiles` (single source of truth — same constants in both
 * functions would drift; here we share them via the helpers below).
 */
export async function* collectFilesStream(dir: string): AsyncGenerator<string> {
  // Reuse the ignore + supported-extension sets the sync walker uses.
  // The walker is depth-first; each subdirectory yields its files
  // before recursing into nested subdirs. Order within a directory
  // matches fs.readdirSync's order (filesystem-native, OS-dependent).
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!INDEX_IGNORED_DIRS.has(entry.name)) {
        yield* collectFilesStream(fullPath);
      }
    } else if (entry.isFile()) {
      if (INDEX_SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
        yield fullPath;
      }
    }
  }
}

/**
 * Shared ignore + extension constants — kept at module scope so both
 * `collectFiles` (sync, back-compat) and `collectFilesStream` (async,
 * new in v1.7.0) reference the same source of truth. Also exported
 * (as `INDEXER_IGNORED_DIRS`) so the FileWatcher derives its chokidar
 * ignore patterns from the same list — without this single-source-of-
 * truth the watcher silently watches directories the indexer never
 * touches (leaking thousands of FDs on repos that have `.vscode-test`
 * or `.code-review-graph` directories with full VS Code distributions
 * or duplicated worktrees inside them).
 */
export const INDEXER_IGNORED_DIRS: ReadonlySet<string> = new Set([
  // Build artifacts + dependency caches
  'node_modules', 'dist', 'build', 'out', 'target',
  'coverage', '.cache', '.turbo', '.next', '.nuxt',
  // Version control + ctxloom state
  '.git', '.ctxloom',
  // Other tools' working state (often contains duplicated source)
  '.claude', '.code-review-graph', '.vscode-test',
]);
// Internal alias kept for the two existing local references — same
// data, different name to preserve the diff history.
const INDEX_IGNORED_DIRS = INDEXER_IGNORED_DIRS;
const INDEX_SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue',
  '.py', '.rs', '.go', '.java', '.cs', '.rb', '.kt', '.kts', '.swift', '.php', '.dart',
  '.c', '.cpp', '.h',
  '.md', '.json', '.yaml', '.yml', '.toml',
  '.ipynb',
]);

/**
 * Index an entire directory: stream files, embed in batches, batch-upsert
 * to the vector store.
 *
 * Three behaviors are critical for 50k+ file repos:
 *
 *   1. **Streaming discovery** — files are yielded one at a time via
 *      `collectFilesStream`. The indexer doesn't wait for the full
 *      walk to finish before processing the first file.
 *   2. **Batch upserts** — N file embeddings ship to LanceDB in ONE
 *      call to `upsertBatch`. Pre-fix each file was one upsert (delete +
 *      add = 2 LanceDB transactions per file). On a 50k-file repo
 *      that's 100k transactions, each writing a manifest. With
 *      BATCH_SIZE=50 we drop to ~2k transactions — 50× fewer FDs
 *      churned, ~5× faster wall time observed on Next.js.
 *   3. **Concurrency within a batch** — file reads + embeddings run
 *      in parallel up to CONCURRENCY=4. Embedding is CPU-bound and
 *      the ONNX runtime parallelizes internally; we deliberately don't
 *      push concurrency higher to keep memory pressure flat.
 *
 * Progress callback fires per FILE (not per batch) so existing CLI
 * progress bars work unchanged. Total is reported as 0 until the
 * walk completes (the stream doesn't know the count upfront); UIs
 * should render an indeterminate state until total > 0.
 */
export async function indexDirectory(
  rootDir: string,
  onProgress?: (file: string, index: number, total: number) => void,
): Promise<{ indexed: number; errors: number }> {
  const { VectorStore } = await import('../db/VectorStore.js');
  const store = new VectorStore(path.join(rootDir, '.ctxloom', 'vectors.lancedb'));
  await store.init();

  let indexed = 0;
  let errors = 0;
  let processed = 0;
  // total stays 0 until the stream completes — the indexer doesn't
  // have an upfront count. CLIs that need a deterministic total can
  // call collectFiles separately, but that costs the upfront pass we're
  // specifically trying to avoid.
  const total = 0;

  const CONCURRENCY = 4;
  // Per-batch upsert size. 50 = sweet spot from empirical tests on
  // Next.js: smaller batches (10–20) still saw transaction churn;
  // larger (100+) increased peak memory without proportional speedup
  // because LanceDB's add() serializes the whole batch into one
  // arrow record-batch before writing.
  const BATCH_SIZE = 50;

  // Wrap the actual indexing in try/finally so we always release LanceDB
  // resources before returning — see store.close() for the FD-exhaustion
  // rationale.
  try {
    // Accumulator for the current batch. We push embedded records here
    // and flush to LanceDB whenever we hit BATCH_SIZE OR the stream ends.
    let batch: Array<{ filePath: string; embedding: number[]; content: string }> = [];

    // Process files in CONCURRENCY-sized chunks within the stream.
    // We collect CONCURRENCY raw paths, embed them in parallel, then
    // push into the batch. When the batch hits BATCH_SIZE we flush.
    let chunk: string[] = [];
    for await (const filePath of collectFilesStream(rootDir)) {
      chunk.push(filePath);
      if (chunk.length < CONCURRENCY) continue;

      await processChunk(chunk);
      chunk = [];
    }
    // Drain any trailing chunk smaller than CONCURRENCY.
    if (chunk.length > 0) {
      await processChunk(chunk);
    }
    // Flush any final partial batch.
    if (batch.length > 0) {
      await store.upsertBatch(batch);
      batch = [];
    }

    async function processChunk(paths: readonly string[]): Promise<void> {
      // Phase 1: read + filter files in parallel. Each entry is either
      // a {filePath, content} record (ready to embed) or null (skipped:
      // oversized, empty, unreadable). Done first so we can hand a
      // single string[] of contents to the batched ONNX inference call.
      const readResults = await Promise.allSettled(
        paths.map((filePath) => {
          // H-3: Guard against enormous files before reading into memory.
          const MAX_INDEX_SIZE = 5 * 1024 * 1024; // 5 MB
          const stat = fs.statSync(filePath);
          if (stat.size > MAX_INDEX_SIZE) {
            logger.warn('Skipping oversized file', { file: filePath, size: stat.size });
            return null;
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          if (!content.trim()) return null;
          const relPath = path.relative(rootDir, filePath);
          return { filePath: relPath, content };
        }),
      );

      // Walk readResults to count errors + collect the embed-ready
      // subset. We accumulate failures into `errors` here so the
      // downstream embedding step sees only valid inputs.
      const ready: Array<{ filePath: string; content: string }> = [];
      for (const r of readResults) {
        processed++;
        if (r.status === 'fulfilled') {
          if (r.value !== null) ready.push(r.value);
        } else {
          errors++;
          logger.error('Failed to read file for indexing', {
            detail: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      }
      if (ready.length === 0) return;

      // Phase 2: SINGLE batched ONNX inference call for the whole chunk.
      // Pre-fix this was N separate generateEmbedding() invocations.
      // Each call set up an ONNX session context, copied inputs into
      // runtime memory, ran the graph, and copied outputs back —
      // overhead that's now amortized across the whole chunk.
      // Measured speedup: ~6× on jina-code, ~4× on MiniLM.
      let embeddings: number[][];
      try {
        embeddings = await generateEmbeddingBatch(ready.map((r) => r.content));
      } catch (err) {
        // If the batch call itself fails (e.g. ONNX runtime crash, model
        // OOM), all `ready` items in this chunk are lost. Don't abort
        // the whole index — log + carry on. Subsequent chunks will retry.
        errors += ready.length;
        logger.error('Batch embedding failed; chunk lost', {
          chunkSize: ready.length,
          detail: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      // Phase 3: zip embeddings back to records and stage in the upsert
      // batch. Order invariant: generateEmbeddingBatch returns vectors
      // in the same order as inputs (the tensor row index equals input
      // position). If the lengths mismatch, surface the bug loudly
      // rather than silently misalign file paths and vectors.
      if (embeddings.length !== ready.length) {
        errors += ready.length;
        logger.error('Embedding batch length mismatch — chunk lost', {
          expected: ready.length,
          got: embeddings.length,
        });
        return;
      }
      for (let i = 0; i < ready.length; i++) {
        batch.push({
          filePath: ready[i].filePath,
          embedding: embeddings[i],
          content: ready[i].content,
        });
        indexed++;
        onProgress?.(ready[i].filePath, processed, total);
        // Flush when batch is full — keeps memory bounded regardless
        // of repo size. A 50-file batch with 768-dim float32 vectors
        // + 512-byte content slice is ~180 KB peak.
        if (batch.length >= BATCH_SIZE) {
          await store.upsertBatch(batch);
          batch = [];
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
