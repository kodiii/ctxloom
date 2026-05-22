/**
 * CI pre-warm: load the embedder once before the test suite imports it.
 *
 * Why this script exists:
 *
 *   The embedder lazy-downloads sentence-transformers/all-MiniLM-L6-v2
 *   (~90 MB) via @huggingface/transformers on first use. On fresh CI
 *   runners, the download finalization races the next ONNX `Load model`
 *   open — the file looks complete but the OS page cache hasn't fsync'd,
 *   so onnxruntime hits a partial Protobuf header and throws.
 *
 *   The embedder retries (3 attempts, 1s/2s backoff), but the race won
 *   that window 8+ times during the v1.7.0 cycle. Running ONE
 *   generateEmbedding call from a controlled step (with its own retry,
 *   isolated from the test runner) lets the download settle before any
 *   test imports the pipeline.
 *
 * This script is run from .github/workflows/ci.yml between
 * `npm run build` and `npm test`. Local runs of `npm test` don't need
 * it (the developer's cache is already warm); it's CI-only.
 */
import { generateEmbedding } from '../../packages/core/src/indexer/embedder.js';

const start = Date.now();
const vector = await generateEmbedding('ctxloom CI warmup');
const ms = Date.now() - start;
console.log(`ctxloom CI: embedder warmed in ${ms} ms — vector dim ${vector.length}`);
