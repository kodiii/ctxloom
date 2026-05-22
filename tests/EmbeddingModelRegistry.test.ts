/**
 * Tests for the embedding-model registry resolver introduced in v1.7.0.
 *
 * The resolver is a pure function over an env-vars object — we never
 * mutate `process.env` here. That keeps the tests order-independent and
 * leaves the module-level `ACTIVE_MODEL` binding (captured at import
 * time from the real process.env) untouched.
 */
import { describe, it, expect } from 'vitest';
import { resolveEmbeddingModel } from '../src/indexer/embedder.js';

describe('resolveEmbeddingModel', () => {
  it('defaults to MiniLM when CTXLOOM_EMBEDDING_MODEL is unset', () => {
    const model = resolveEmbeddingModel({});
    expect(model.hfId).toBe('sentence-transformers/all-MiniLM-L6-v2');
    expect(model.dim).toBe(384);
  });

  it('defaults to MiniLM on empty/whitespace env values', () => {
    expect(resolveEmbeddingModel({ CTXLOOM_EMBEDDING_MODEL: '' }).hfId).toMatch(/MiniLM/);
    expect(resolveEmbeddingModel({ CTXLOOM_EMBEDDING_MODEL: '   ' }).hfId).toMatch(/MiniLM/);
  });

  it('resolves the "minilm" alias to the historical default (back-compat)', () => {
    const model = resolveEmbeddingModel({ CTXLOOM_EMBEDDING_MODEL: 'minilm' });
    expect(model.hfId).toBe('sentence-transformers/all-MiniLM-L6-v2');
    expect(model.dim).toBe(384);
  });

  it('resolves the "jina-code" alias to the v1.7.0 code-specific upgrade', () => {
    const model = resolveEmbeddingModel({ CTXLOOM_EMBEDDING_MODEL: 'jina-code' });
    expect(model.hfId).toBe('jinaai/jina-embeddings-v2-base-code');
    expect(model.dim).toBe(768);
    // ~140 MB; truncated-download guard should be in the right ballpark.
    expect(model.minBytes).toBeGreaterThanOrEqual(100 * 1024 * 1024);
  });

  it('accepts a raw HuggingFace id when CTXLOOM_EMBEDDING_DIM is also set', () => {
    const model = resolveEmbeddingModel({
      CTXLOOM_EMBEDDING_MODEL: 'BAAI/bge-small-en-v1.5',
      CTXLOOM_EMBEDDING_DIM: '384',
    });
    expect(model.hfId).toBe('BAAI/bge-small-en-v1.5');
    expect(model.dim).toBe(384);
  });

  it('throws when a raw HF id is given without CTXLOOM_EMBEDDING_DIM', () => {
    // Refuses to guess — silent dim mismatch corrupts the LanceDB table
    // layout downstream, which is far worse than a startup error.
    expect(() =>
      resolveEmbeddingModel({ CTXLOOM_EMBEDDING_MODEL: 'unknown/some-model' }),
    ).toThrow(/CTXLOOM_EMBEDDING_DIM/);
  });

  it('throws when CTXLOOM_EMBEDDING_DIM is non-numeric or non-positive', () => {
    expect(() =>
      resolveEmbeddingModel({
        CTXLOOM_EMBEDDING_MODEL: 'some/model',
        CTXLOOM_EMBEDDING_DIM: 'abc',
      }),
    ).toThrow();
    expect(() =>
      resolveEmbeddingModel({
        CTXLOOM_EMBEDDING_MODEL: 'some/model',
        CTXLOOM_EMBEDDING_DIM: '0',
      }),
    ).toThrow();
    expect(() =>
      resolveEmbeddingModel({
        CTXLOOM_EMBEDDING_MODEL: 'some/model',
        CTXLOOM_EMBEDDING_DIM: '-5',
      }),
    ).toThrow();
  });

  it('error message lists the known aliases so users can self-correct', () => {
    let caught: unknown;
    try {
      resolveEmbeddingModel({ CTXLOOM_EMBEDDING_MODEL: 'totally-fake' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toContain('minilm');
    expect(msg).toContain('jina-code');
  });
});
