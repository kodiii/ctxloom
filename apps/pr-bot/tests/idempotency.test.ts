import { describe, it, expect } from 'vitest';
import {
  findBotComment,
  buildCommentBody,
  markerForSha,
  SUMMARY_MARKER_PREFIX,
} from '../src/review/idempotency.js';
import type { ReviewPayload } from '../src/review/types.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const PR = {
  owner: 'acme',
  repo: 'api',
  number: 42,
  headSha: 'abc123',
  baseSha: 'base000',
};

function makePayload(headSha = 'abc123'): ReviewPayload {
  return {
    pr: { ...PR, headSha },
    riskScore: 0.2,
    riskLabel: 'low',
    changedFiles: [
      {
        file: 'src/foo.ts',
        riskLevel: 'low',
        importerCount: 1,
        isHub: false,
        hasTestCoverage: true,
        risk: null,
      },
    ],
    impact: {
      seedFiles: ['src/foo.ts'],
      directImporters: [],
      transitiveImporters: [],
      historicalCoupling: [],
      totalImpacted: 0,
    },
    suggestedReviewers: [],
    config: DEFAULT_CONFIG,
  };
}

describe('findBotComment', () => {
  it('returns the comment containing the marker for the given sha', () => {
    const sha = 'abc123';
    const comments = [
      { id: 1, body: 'Regular comment' },
      { id: 2, body: `Some text\n${SUMMARY_MARKER_PREFIX}${sha} -->` },
      { id: 3, body: 'Another comment' },
    ];
    const found = findBotComment(comments, sha);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(2);
  });

  it('returns null when no comment contains the marker', () => {
    const comments = [
      { id: 1, body: 'Regular comment' },
      { id: 2, body: 'Another comment' },
    ];
    const result = findBotComment(comments, 'abc123');
    expect(result).toBeNull();
  });

  it('finds existing comment even if SHA changed (any ctxloom:review: marker)', () => {
    const oldSha = 'oldshaXXX';
    const comments = [
      { id: 1, body: 'Regular comment' },
      { id: 2, body: `Review\n${SUMMARY_MARKER_PREFIX}${oldSha} -->` },
    ];
    // Should find even with a different sha
    const found = findBotComment(comments, 'newshaYYY');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(2);
  });
});

describe('buildCommentBody', () => {
  it('returns a string containing the marker', () => {
    const payload = makePayload('sha999');
    const body = buildCommentBody(payload);
    expect(typeof body).toBe('string');
    expect(body).toContain(`${SUMMARY_MARKER_PREFIX}sha999 -->`);
  });

  it('marker is idempotent: same sha produces same marker in output', () => {
    const sha = 'stable-sha';
    const body1 = buildCommentBody(makePayload(sha));
    const body2 = buildCommentBody(makePayload(sha));
    expect(body1).toBe(body2);
  });

  it('different sha produces different marker', () => {
    const body1 = buildCommentBody(makePayload('sha-aaa'));
    const body2 = buildCommentBody(makePayload('sha-bbb'));
    expect(body1).not.toBe(body2);
    expect(body1).toContain(`${SUMMARY_MARKER_PREFIX}sha-aaa -->`);
    expect(body2).toContain(`${SUMMARY_MARKER_PREFIX}sha-bbb -->`);
  });
});

describe('markerForSha', () => {
  it('returns the full marker string for a sha', () => {
    const marker = markerForSha('deadbeef');
    expect(marker).toBe('<!-- ctxloom:review:deadbeef -->');
  });
});
