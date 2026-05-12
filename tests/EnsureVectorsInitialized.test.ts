/**
 * Unit tests for ensureVectorsInitialized (Task 6.5).
 *
 * Verifies:
 *   - Returns immediately when vectorsInitialized is already true (idempotent)
 *   - Returns immediately when storePromise is null (store never started)
 *   - Awaits storePromise and sets vectorsInitialized=true on first call
 *   - Concurrent calls share the same storePromise (no double-init)
 *   - Flag remains true after successful initialization
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ensureVectorsInitialized,
  createProjectState,
} from '../packages/core/src/server/ProjectState.js';

describe('ensureVectorsInitialized', () => {
  it('returns immediately without touching storePromise when vectorsInitialized is already true', async () => {
    const state = createProjectState('/abs/foo');
    state.vectorsInitialized = true;
    // storePromise is null — if this function awaited it, it would skip (null guard).
    // We verify it does not change the flag or throw.
    await expect(ensureVectorsInitialized(state)).resolves.toBeUndefined();
    expect(state.vectorsInitialized).toBe(true);
  });

  it('returns immediately when storePromise is null (store never started)', async () => {
    const state = createProjectState('/abs/foo');
    expect(state.storePromise).toBeNull();
    expect(state.vectorsInitialized).toBe(false);

    await expect(ensureVectorsInitialized(state)).resolves.toBeUndefined();

    // Flag must remain false — we did not initialize vectors
    expect(state.vectorsInitialized).toBe(false);
  });

  it('awaits storePromise and sets vectorsInitialized=true when storePromise resolves', async () => {
    const state = createProjectState('/abs/foo');
    const fakeStore = { initialized: true };
    state.storePromise = Promise.resolve(fakeStore as never);

    await ensureVectorsInitialized(state);

    expect(state.vectorsInitialized).toBe(true);
  });

  it('is idempotent — second call does nothing when already initialized', async () => {
    const state = createProjectState('/abs/foo');
    const fakeStore = { initialized: true };
    state.storePromise = Promise.resolve(fakeStore as never);

    await ensureVectorsInitialized(state);
    expect(state.vectorsInitialized).toBe(true);

    // Null out storePromise to confirm the second call short-circuits on the
    // vectorsInitialized flag, not on storePromise.
    state.storePromise = null;

    await expect(ensureVectorsInitialized(state)).resolves.toBeUndefined();
    expect(state.vectorsInitialized).toBe(true);
  });

  it('concurrent calls all resolve and leave flag=true (shared promise, no double-init)', async () => {
    const state = createProjectState('/abs/foo');
    let resolveStore!: (v: unknown) => void;
    state.storePromise = new Promise((res) => { resolveStore = res; }) as never;

    // Launch three concurrent calls before the store resolves
    const p1 = ensureVectorsInitialized(state);
    const p2 = ensureVectorsInitialized(state);
    const p3 = ensureVectorsInitialized(state);

    // Resolve the underlying store
    resolveStore({ initialized: true });

    await Promise.all([p1, p2, p3]);

    expect(state.vectorsInitialized).toBe(true);
  });

  it('leaves vectorsInitialized=false when storePromise rejects', async () => {
    const state = createProjectState('/abs/foo');
    state.storePromise = Promise.reject(new Error('init failed')) as never;

    await expect(ensureVectorsInitialized(state)).rejects.toThrow('init failed');
    expect(state.vectorsInitialized).toBe(false);
  });
});
