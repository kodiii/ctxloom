import { describe, expect, it } from 'vitest';
import {
  groundTruthFromView,
  type GhPrView,
} from '../scripts/bench/groundTruth.js';

const validView = (overrides: Partial<GhPrView> = {}): GhPrView => ({
  files: [
    { path: 'History.md', additions: 3, deletions: 0 },
    { path: 'lib/request.js', additions: 2, deletions: 2 },
    { path: 'test/req.fresh.js', additions: 38, deletions: 0 },
  ],
  baseRefName: 'main',
  mergeCommit: { oid: 'merge-sha' },
  state: 'MERGED',
  mergedAt: '2026-08-26T00:00:00Z',
  ...overrides,
});

describe('groundTruthFromView', () => {
  it('validates a merged default-branch PR and prefers a non-test entry point', () => {
    const result = groundTruthFromView('owner/repo', 42, validView(), 'main');

    expect(result).toEqual({
      prNumber: 42,
      groundTruthFiles: ['History.md', 'lib/request.js', 'test/req.fresh.js'],
      entryPoint: 'lib/request.js',
      evalSha: 'merge-sha',
    });
  });

  it('rejects PRs targeting a non-default branch', () => {
    expect(() => groundTruthFromView(
      'owner/repo',
      42,
      validView({ baseRefName: 'maintenance' }),
      'main',
    )).toThrow(/targets maintenance, not the repository default branch main/);
  });

  it('rejects PRs without a reproducible merge commit', () => {
    expect(() => groundTruthFromView(
      'owner/repo',
      42,
      validView({ mergeCommit: null }),
      'main',
    )).toThrow(/no merge commit OID/);
  });

  it('rejects unmerged PRs', () => {
    expect(() => groundTruthFromView(
      'owner/repo',
      42,
      validView({ state: 'OPEN', mergedAt: null }),
      'main',
    )).toThrow(/not MERGED/);
  });

  it('rejects PRs with fewer than two source files', () => {
    expect(() => groundTruthFromView(
      'owner/repo',
      42,
      validView({
        files: [
          { path: 'CHANGELOG.md', additions: 1, deletions: 0 },
          { path: 'src/only.ts', additions: 1, deletions: 0 },
        ],
      }),
      'main',
    )).toThrow(/touches only 1 source file/);
  });
});
