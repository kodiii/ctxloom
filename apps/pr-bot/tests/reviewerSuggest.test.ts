import { describe, it, expect } from 'vitest';
import { suggestReviewers } from '../src/review/reviewerSuggest.js';
import { GitOverlayStore } from '../../../src/git/GitOverlayStore.js';

function seedOwnership(
  store: GitOverlayStore,
  file: string,
  owners: Array<{ author: string; email: string; share: number }>,
): void {
  const totalWeight = 1000;
  for (const owner of owners) {
    const weight = Math.round(owner.share * totalWeight);
    if (weight <= 0) continue;
    store.ownership.ingest({
      sha: `fake-${owner.author}-${file}`,
      author: owner.author,
      authorEmail: owner.email,
      timestamp: Math.floor(Date.now() / 1000) - 100,
      message: '',
      files: [{ path: file, added: weight, deleted: 0 }],
      isMerge: false,
      isBulk: false,
    });
  }
}

function makeOverlay(
  entries: Array<{
    file: string;
    owners: Array<{ author: string; email: string; share: number }>;
  }>,
): GitOverlayStore {
  const store = new GitOverlayStore();
  for (const { file, owners } of entries) {
    seedOwnership(store, file, owners);
  }
  return store;
}

describe('suggestReviewers', () => {
  it('ranks recent approvers first, then top owners', () => {
    const overlay = makeOverlay([
      {
        file: 'src/auth.ts',
        owners: [
          { author: 'alice', email: 'alice@example.com', share: 0.6 },
          { author: 'bob', email: 'bob@example.com', share: 0.3 },
          { author: 'carol', email: 'carol@example.com', share: 0.1 },
        ],
      },
    ]);

    const suggestions = suggestReviewers({
      filesTouched: ['src/auth.ts'],
      overlay,
      recentApprovers: ['bob', 'dan'],
      maxSuggestions: 2,
    });

    expect(suggestions).toHaveLength(2);
    // bob is both owner and recent approver → ranked first
    expect(suggestions[0].login).toBe('bob');
    // alice is top owner by share → ranked second
    expect(suggestions[1].login).toBe('alice');
  });

  it('is capped at maxSuggestions (default 2)', () => {
    const overlay = makeOverlay([
      {
        file: 'src/auth.ts',
        owners: [
          { author: 'alice', email: 'alice@example.com', share: 0.5 },
          { author: 'bob', email: 'bob@example.com', share: 0.3 },
          { author: 'carol', email: 'carol@example.com', share: 0.2 },
        ],
      },
    ]);

    const suggestions = suggestReviewers({
      filesTouched: ['src/auth.ts'],
      overlay,
      recentApprovers: [],
    });

    expect(suggestions.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array when overlay is undefined', () => {
    const suggestions = suggestReviewers({
      filesTouched: ['src/auth.ts'],
      overlay: undefined,
      recentApprovers: ['alice'],
    });

    expect(suggestions).toEqual([]);
  });

  it('returns top-2 owners when approvers list is empty', () => {
    const overlay = makeOverlay([
      {
        file: 'src/service.ts',
        owners: [
          { author: 'alice', email: 'alice@example.com', share: 0.6 },
          { author: 'bob', email: 'bob@example.com', share: 0.3 },
          { author: 'carol', email: 'carol@example.com', share: 0.1 },
        ],
      },
    ]);

    const suggestions = suggestReviewers({
      filesTouched: ['src/service.ts'],
      overlay,
      recentApprovers: [],
      maxSuggestions: 2,
    });

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].login).toBe('alice');
    expect(suggestions[1].login).toBe('bob');
  });

  it('includes rationale string for each suggestion', () => {
    const overlay = makeOverlay([
      {
        file: 'src/auth.ts',
        owners: [{ author: 'alice', email: 'alice@example.com', share: 0.7 }],
      },
    ]);

    const suggestions = suggestReviewers({
      filesTouched: ['src/auth.ts'],
      overlay,
      recentApprovers: ['alice'],
      maxSuggestions: 2,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(typeof suggestions[0].rationale).toBe('string');
    expect(suggestions[0].rationale.length).toBeGreaterThan(0);
  });

  it('handles file not in overlay gracefully (returns empty)', () => {
    const overlay = new GitOverlayStore();

    const suggestions = suggestReviewers({
      filesTouched: ['src/unknown.ts'],
      overlay,
      recentApprovers: ['alice'],
    });

    expect(suggestions).toEqual([]);
  });
});
