import { describe, it, expect } from 'vitest';
import { scoreReviewers } from '../src/review/ReviewerScorer.js';
import { OwnershipIndex } from '../src/git/OwnershipIndex.js';
import { CoChangeIndex } from '../src/git/CoChangeIndex.js';
import { DEFAULT_REVIEW_CONFIG } from '../src/review/types.js';
import type { CandidateActivity } from '../src/review/types.js';

const NOW = 1_800_000_000; // fixed unix seconds for deterministic tests

function makeOwnership() {
  const idx = new OwnershipIndex();
  // Alice: heavy owner of auth.ts (10 lines)
  idx.ingest({ sha: 'c1', author: 'Alice', authorEmail: 'alice@x.com',
    timestamp: NOW - 86400 * 10, message: '',
    files: [{ path: 'src/auth.ts', added: 10, deleted: 0 }],
    isBulk: false, isMerge: false });
  // Bob: minor owner (2 lines)
  idx.ingest({ sha: 'c2', author: 'Bob', authorEmail: 'bob@x.com',
    timestamp: NOW - 86400 * 5, message: '',
    files: [{ path: 'src/auth.ts', added: 2, deleted: 0 }],
    isBulk: false, isMerge: false });
  return idx;
}

function makeCoChange() {
  return new CoChangeIndex(); // empty — no co-change signal
}

function makeActivity(daysAgo: number): CandidateActivity[] {
  return [
    { email: 'alice@x.com', lastCommitTimestamp: NOW - 86400 * daysAgo },
    { email: 'bob@x.com',   lastCommitTimestamp: NOW - 86400 * daysAgo },
  ];
}

describe('scoreReviewers', () => {
  it('ranks alice above bob (higher ownership share)', () => {
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      makeActivity(5),
      'author@x.com',
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    expect(result.suggestions[0]!.breakdown.email).toBe('alice@x.com');
    expect(result.suggestions[1]!.breakdown.email).toBe('bob@x.com');
  });

  it('excludes the PR author', () => {
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      makeActivity(5),
      'alice@x.com', // alice is the author
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    expect(result.suggestions.every(s => s.breakdown.email !== 'alice@x.com')).toBe(true);
  });

  it('applies staleness filter for candidates older than threshold', () => {
    const staleActivity: CandidateActivity[] = [
      { email: 'alice@x.com', lastCommitTimestamp: NOW - 86400 * 200 }, // > 180d
      { email: 'bob@x.com',   lastCommitTimestamp: NOW - 86400 * 200 },
    ];
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      staleActivity,
      'nobody@x.com',
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    expect(result.suggestions).toHaveLength(0);
  });

  it('applies staleness penalty (not filter) for candidates between 90-180d', () => {
    const midActivity: CandidateActivity[] = [
      { email: 'alice@x.com', lastCommitTimestamp: NOW - 86400 * 120 },
      { email: 'bob@x.com',   lastCommitTimestamp: NOW - 86400 * 120 },
    ];
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      midActivity,
      'nobody@x.com',
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    // present but with penalty
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]!.breakdown.stalenessMultiplier).toBe(0.3);
  });

  it('emits bus factor warning when busFactor <= 2', () => {
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      makeActivity(5),
      'nobody@x.com',
      DEFAULT_REVIEW_CONFIG,
      NOW,
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]!.busFactor).toBeLessThanOrEqual(2);
  });

  it('respects max from config', () => {
    const cfg = { ...DEFAULT_REVIEW_CONFIG, defaults: { ...DEFAULT_REVIEW_CONFIG.defaults, max: 1 } };
    const result = scoreReviewers(
      ['src/auth.ts'],
      makeOwnership(),
      makeCoChange(),
      makeActivity(5),
      'nobody@x.com',
      cfg,
      NOW,
    );
    expect(result.suggestions).toHaveLength(1);
  });
});
