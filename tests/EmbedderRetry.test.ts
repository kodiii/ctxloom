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
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
