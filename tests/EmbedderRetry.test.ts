/**
 * Unit tests for the embedder's first-load retry logic.
 *
 * On a fresh install, @huggingface/transformers downloads the ONNX model
 * lazily; onnxruntime can race the FS-cache flush and throw "Protobuf
 * parsing failed" on first open. The file is correctly written; a single
 * retry after a short delay catches the race.
 *
 * These tests mock @huggingface/transformers's `pipeline` factory so we
 * don't hit the network or load a real 90 MB model.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// vi.mock is hoisted; module body has no closure access from outside.
// Define the mock inside the factory using a module-level mockable.
let pipelineMock: ReturnType<typeof vi.fn>;

vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}));

beforeEach(async () => {
  pipelineMock = vi.fn();
  // Reset the embedder module's singleton between tests.
  vi.resetModules();
});

const fakePipe = Object.assign(
  () => ({ tolist: () => [new Array(384).fill(0)] }),
  {} as Record<string, never>,
);

describe('embedder first-load retry', () => {
  it('retries on protobuf parse error and succeeds', async () => {
    pipelineMock
      .mockRejectedValueOnce(new Error('Load model from /path failed:Protobuf parsing failed.'))
      .mockResolvedValueOnce(fakePipe);

    const { generateEmbedding } = await import('../src/indexer/embedder.js');
    const embedding = await generateEmbedding('hello');

    expect(embedding.length).toBe(384);
    expect(pipelineMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('retries up to 3 times before giving up', async () => {
    const protobufErr = new Error('Protobuf parsing failed.');
    pipelineMock
      .mockRejectedValueOnce(protobufErr)
      .mockRejectedValueOnce(protobufErr)
      .mockRejectedValueOnce(protobufErr);

    const { generateEmbedding } = await import('../src/indexer/embedder.js');
    await expect(generateEmbedding('hello')).rejects.toThrow(/Protobuf/);
    expect(pipelineMock).toHaveBeenCalledTimes(3);
  }, 15_000);

  it('does NOT retry non-protobuf errors', async () => {
    pipelineMock.mockRejectedValueOnce(new Error('Network error: ENOTFOUND huggingface.co'));

    const { generateEmbedding } = await import('../src/indexer/embedder.js');
    await expect(generateEmbedding('hello')).rejects.toThrow(/Network error/);
    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  // ─── Truncated-model recovery (post-1.0.28 regression) ────────────────

  describe('truncated-model recovery', () => {
    let tmpDir: string;
    let modelPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-model-'));
      modelPath = path.join(tmpDir, 'model.onnx');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('removes the truncated model file and retries with a fresh download', async () => {
      // Simulate a half-finished download on disk (67 MB — like the real
      // crash that motivated this fix; minimum healthy is 80 MB).
      fs.writeFileSync(modelPath, Buffer.alloc(67 * 1024 * 1024));

      // First attempt: report the truncated bytes can't be parsed.
      // Second attempt: succeed (mimicking a clean re-download).
      pipelineMock
        .mockRejectedValueOnce(
          new Error(`Load model from ${modelPath} failed:Protobuf parsing failed.`),
        )
        .mockResolvedValueOnce(fakePipe);

      const { generateEmbedding } = await import('../src/indexer/embedder.js');
      const embedding = await generateEmbedding('hello');

      expect(embedding.length).toBe(384);
      // Two pipeline() calls — initial fail, then re-download succeeds.
      expect(pipelineMock).toHaveBeenCalledTimes(2);
      // The truncated file was removed.
      expect(fs.existsSync(modelPath)).toBe(false);
    }, 15_000);

    it('does NOT remove a healthy-sized model file (treats it as flush race)', async () => {
      // 90 MB — looks like a complete download. Even though it parses bad
      // here, we don't dare delete it; fall through to the existing
      // backoff path and let the flush settle. (Worst case: 3 failures
      // and the user investigates manually.)
      fs.writeFileSync(modelPath, Buffer.alloc(90 * 1024 * 1024));

      pipelineMock
        .mockRejectedValueOnce(
          new Error(`Load model from ${modelPath} failed:Protobuf parsing failed.`),
        )
        .mockResolvedValueOnce(fakePipe);

      const { generateEmbedding } = await import('../src/indexer/embedder.js');
      const embedding = await generateEmbedding('hello');

      expect(embedding.length).toBe(384);
      // File still on disk — we only delete files we're confident are truncated.
      expect(fs.existsSync(modelPath)).toBe(true);
    }, 15_000);

    it('gives up cleanly when the truncated file cannot be removed', async () => {
      // No file at the reported path — the unlink will throw ENOENT.
      // tryRemoveTruncatedModel must swallow that and fall through to
      // the backoff path, so the test still completes via the success
      // on attempt 2 (not via an unhandled error).
      const missingPath = path.join(tmpDir, 'never-existed.onnx');
      pipelineMock
        .mockRejectedValueOnce(
          new Error(`Load model from ${missingPath} failed:Protobuf parsing failed.`),
        )
        .mockResolvedValueOnce(fakePipe);

      const { generateEmbedding } = await import('../src/indexer/embedder.js');
      const embedding = await generateEmbedding('hello');

      expect(embedding.length).toBe(384);
      expect(pipelineMock).toHaveBeenCalledTimes(2);
    }, 15_000);
  });

  it('concurrent first-call requests share one in-flight load', async () => {
    let resolveLoad: ((value: typeof fakePipe) => void) | undefined;
    pipelineMock.mockImplementationOnce(
      () => new Promise<typeof fakePipe>((resolve) => { resolveLoad = resolve; }),
    );

    const { generateEmbedding } = await import('../src/indexer/embedder.js');
    const p1 = generateEmbedding('a');
    const p2 = generateEmbedding('b');
    const p3 = generateEmbedding('c');

    // Three concurrent calls should still trigger only ONE pipeline load.
    expect(pipelineMock).toHaveBeenCalledTimes(1);

    // Resolve the one in-flight load; all three should complete.
    resolveLoad!(fakePipe);
    await Promise.all([p1, p2, p3]);

    // Subsequent calls reuse the cached embedder — no new load.
    await generateEmbedding('d');
    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });
});
