/**
 * Tests for CoChangeIndex — sparse co-change pair matrix with
 * Jaccard similarity and recency-decayed confidence.
 */
import { describe, it, expect } from 'vitest';
import { CoChangeIndex } from '../src/git/CoChangeIndex.js';
import type { GitCommitEvent } from '../src/git/GitHistoryMiner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  sha: string,
  paths: string[],
  timestamp: number,
  isBulk = false,
  isMerge = false,
): GitCommitEvent {
  return {
    sha,
    author: 'Test Author',
    authorEmail: 'test@example.com',
    timestamp,
    message: `commit ${sha}`,
    files: paths.map((p) => ({ path: p, added: 1, deleted: 0 })),
    isBulk,
    isMerge,
  };
}

const NOW = Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CoChangeIndex', () => {
  // -------------------------------------------------------------------------
  // 1. Basic pair scoring
  // -------------------------------------------------------------------------
  describe('basic pair scoring', () => {
    it('computes jaccard, sharedCommits, countA, countB correctly', () => {
      const idx = new CoChangeIndex();

      // commit 1: A + B co-appear
      idx.ingest(makeEvent('sha1', ['A', 'B'], NOW - 300));
      // commit 2: A alone (not with B)
      idx.ingest(makeEvent('sha2', ['A', 'C'], NOW - 200));
      // commit 3: B alone (not with A), C alone
      idx.ingest(makeEvent('sha3', ['B', 'D'], NOW - 100));
      // commit 4: A + B co-appear again
      idx.ingest(makeEvent('sha4', ['A', 'B'], NOW - 50));

      const pairs = idx.allFor('A');
      const abPair = pairs.find(
        (p) => (p.nodeA === 'A' && p.nodeB === 'B') || (p.nodeA === 'B' && p.nodeB === 'A'),
      );

      expect(abPair).toBeDefined();
      expect(abPair!.sharedCommits).toBe(2);
      // countA = commits touching A = sha1, sha2, sha4 = 3
      // countB = commits touching B = sha1, sha3, sha4 = 3
      expect(abPair!.countA).toBe(3);
      expect(abPair!.countB).toBe(3);
      // jaccard = 2 / (3 + 3 - 2) = 2/4 = 0.5
      expect(abPair!.jaccard).toBeCloseTo(0.5, 5);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Confidence with recency decay
  // -------------------------------------------------------------------------
  describe('confidence with recency decay', () => {
    it('recent pair has higher confidence than 90-days-ago pair', () => {
      const idx = new CoChangeIndex();

      // Recent pair: P + Q with 4 shared commits, last shared = now
      const recentTs = NOW;
      for (let i = 0; i < 4; i++) {
        idx.ingest(makeEvent(`recent-sha${i}`, ['P', 'Q'], recentTs - i * 10));
      }

      // Stale pair: X + Y with 4 shared commits, last shared = 90 days ago
      const staleTs = NOW - 90 * 86400;
      for (let i = 0; i < 4; i++) {
        idx.ingest(makeEvent(`stale-sha${i}`, ['X', 'Y'], staleTs - i * 10));
      }

      const recentResults = idx.topFor({ node: 'P', now: NOW, halfLifeDays: 90 });
      const staleResults = idx.topFor({ node: 'X', now: NOW, halfLifeDays: 90 });

      expect(recentResults.length).toBeGreaterThan(0);
      expect(staleResults.length).toBeGreaterThan(0);

      const recentConf = recentResults[0]!.confidence;
      const staleConf = staleResults[0]!.confidence;

      expect(recentConf).toBeGreaterThan(staleConf);
      // At exactly the half-life (90 days), decay factor = 0.5
      expect(staleConf).toBeCloseTo(recentConf * 0.5, 2);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Noise filter (minShared = 3)
  // -------------------------------------------------------------------------
  describe('noise filter', () => {
    it('topFor returns empty when sharedCommits < 3', () => {
      const idx = new CoChangeIndex();

      // Only 2 shared commits between X and Y
      idx.ingest(makeEvent('n1', ['X', 'Y'], NOW - 200));
      idx.ingest(makeEvent('n2', ['X', 'Y'], NOW - 100));

      const results = idx.topFor({ node: 'X', now: NOW });
      expect(results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. topFor ordering
  // -------------------------------------------------------------------------
  describe('topFor ordering', () => {
    it('returns pairs in descending confidence order', () => {
      const idx = new CoChangeIndex();

      // A+B: 5 shared commits, recent
      for (let i = 0; i < 5; i++) {
        idx.ingest(makeEvent(`ab${i}`, ['A', 'B'], NOW - i * 10));
      }
      // A+C: 3 shared commits, older
      for (let i = 0; i < 3; i++) {
        idx.ingest(makeEvent(`ac${i}`, ['A', 'C'], NOW - 180 * 86400 - i * 10));
      }

      const results = idx.topFor({ node: 'A', now: NOW });
      expect(results.length).toBeGreaterThanOrEqual(2);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.confidence).toBeGreaterThanOrEqual(results[i]!.confidence);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. allFor — no filter
  // -------------------------------------------------------------------------
  describe('allFor', () => {
    it('returns all pairs regardless of noise filter', () => {
      const idx = new CoChangeIndex();

      // Only 2 shared commits — below minShared=3 noise filter
      idx.ingest(makeEvent('af1', ['M', 'N'], NOW - 200));
      idx.ingest(makeEvent('af2', ['M', 'N'], NOW - 100));

      // topFor should be empty
      expect(idx.topFor({ node: 'M', now: NOW })).toHaveLength(0);
      // allFor should return the pair
      const all = idx.allFor('M');
      expect(all).toHaveLength(1);
      const pair = all[0]!;
      expect(pair.sharedCommits).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Snapshot round-trip
  // -------------------------------------------------------------------------
  describe('snapshot round-trip', () => {
    it('restores state from snapshot and produces same topFor results', () => {
      const idx = new CoChangeIndex();

      for (let i = 0; i < 4; i++) {
        idx.ingest(makeEvent(`rt${i}`, ['Alpha', 'Beta'], NOW - i * 100));
      }

      const snap = idx.snapshot();
      const restored = CoChangeIndex.load(snap);

      const original = idx.topFor({ node: 'Alpha', now: NOW });
      const fromSnap = restored.topFor({ node: 'Alpha', now: NOW });

      expect(fromSnap).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(fromSnap[i]!.nodeA).toBe(original[i]!.nodeA);
        expect(fromSnap[i]!.nodeB).toBe(original[i]!.nodeB);
        expect(fromSnap[i]!.sharedCommits).toBe(original[i]!.sharedCommits);
        expect(fromSnap[i]!.confidence).toBeCloseTo(original[i]!.confidence, 5);
      }
    });

    it('snapshot() returns a deep copy (mutation of snapshot does not affect index)', () => {
      const idx = new CoChangeIndex();
      for (let i = 0; i < 4; i++) {
        idx.ingest(makeEvent(`dc${i}`, ['G', 'H'], NOW - i * 10));
      }

      const snap = idx.snapshot();
      snap.pairs[0]!.sharedCommits = 9999;

      const results = idx.topFor({ node: 'G', now: NOW });
      expect(results[0]!.sharedCommits).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Bulk and merge commits are ignored
  // -------------------------------------------------------------------------
  describe('bulk and merge commits ignored', () => {
    it('isBulk=true events do not add pairs', () => {
      const idx = new CoChangeIndex();
      idx.ingest(makeEvent('bulk1', ['F1', 'F2'], NOW, true, false));

      expect(idx.allFor('F1')).toHaveLength(0);
      expect(idx.size().pairs).toBe(0);
    });

    it('isMerge=true events do not add pairs', () => {
      const idx = new CoChangeIndex();
      idx.ingest(makeEvent('merge1', ['F3', 'F4'], NOW, false, true));

      expect(idx.allFor('F3')).toHaveLength(0);
      expect(idx.size().pairs).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 8. size() diagnostic
  // -------------------------------------------------------------------------
  describe('size()', () => {
    it('returns correct node and pair counts', () => {
      const idx = new CoChangeIndex();
      for (let i = 0; i < 3; i++) {
        idx.ingest(makeEvent(`s${i}`, ['Node1', 'Node2'], NOW - i * 100));
      }

      const { nodes, pairs } = idx.size();
      expect(nodes).toBe(2);
      expect(pairs).toBe(1);
    });
  });
});
