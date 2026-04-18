import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/graph/DependencyGraph.js', () => ({
  DependencyGraph: vi.fn().mockImplementation(() => ({
    buildFromDirectory: vi.fn().mockResolvedValue(undefined),
    allFiles: vi.fn().mockReturnValue(['src/a.ts', 'src/b.ts']),
    edgeCount: vi.fn().mockReturnValue(3),
    getImports: vi.fn().mockReturnValue([]),
    getImporters: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../../src/git/GitOverlayStore.js', () => ({
  GitOverlayStore: vi.fn().mockImplementation(() => ({
    loadSnapshot: vi.fn().mockResolvedValue(true),
    churn: { statsFor: vi.fn().mockReturnValue(null) },
    ownership: { statsFor: vi.fn().mockReturnValue(null) },
    coChange: { topFor: vi.fn().mockReturnValue([]) },
  })),
}));

import { loadContext } from '../server/loader.js';

describe('loadContext', () => {
  it('returns graph and overlay for a valid root', async () => {
    const ctx = await loadContext('/fake/root');
    expect(ctx.graph).toBeDefined();
    expect(ctx.overlay).toBeDefined();
    expect(ctx.root).toBe('/fake/root');
    expect(ctx.gitEnabled).toBe(true);
  });

  it('sets gitEnabled=false when overlay snapshot is missing', async () => {
    const { GitOverlayStore } = await import('../../src/git/GitOverlayStore.js');
    vi.mocked(GitOverlayStore).mockImplementationOnce(() => ({
      loadSnapshot: vi.fn().mockResolvedValue(false),
      churn: { statsFor: vi.fn().mockReturnValue(null) },
      ownership: { statsFor: vi.fn().mockReturnValue(null) },
      coChange: { topFor: vi.fn().mockReturnValue([]) },
    }) as any);

    const ctx = await loadContext('/fake/root');
    expect(ctx.gitEnabled).toBe(false);
  });
});
