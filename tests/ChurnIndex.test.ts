/**
 * Tests for ChurnIndex — per-node churn, bug-fix density, and author entropy.
 */
import { describe, it, expect } from 'vitest';
import { ChurnIndex } from '../src/git/ChurnIndex.js';
import type { GitCommitEvent } from '../src/git/GitHistoryMiner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<GitCommitEvent> & { files: GitCommitEvent['files'] },
): GitCommitEvent {
  return {
    sha: Math.random().toString(16).slice(2, 10).padEnd(40, '0'),
    author: 'alice',
    authorEmail: 'alice@example.com',
    timestamp: Math.floor(Date.now() / 1000),
    message: 'chore: update',
    isMerge: false,
    isBulk: false,
    ...overrides,
  };
}

const NOW = Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ChurnIndex', () => {
  // -------------------------------------------------------------------------
  // 1. Churn accumulation
  // -------------------------------------------------------------------------
  describe('churn accumulation', () => {
    it('accumulates churnLines and commit count correctly', () => {
      const idx = new ChurnIndex();

      // 5 events: added=10, deleted=5 each → churnLines per event = 15
      for (let i = 0; i < 5; i++) {
        idx.ingest(
          makeEvent({
            files: [{ path: 'src/a.ts', added: 10, deleted: 5 }],
          }),
        );
      }

      const stats = idx.statsFor('src/a.ts');
      expect(stats).not.toBeNull();
      expect(stats!.commits).toBe(5);
      // 5 events × (10 + 5) = 75
      expect(stats!.churnLines).toBe(75);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Bug regex matching
  // -------------------------------------------------------------------------
  describe('bug regex', () => {
    it('increments bugCommits for fix/bug/hotfix/revert messages', () => {
      const idx = new ChurnIndex();

      // Bug commit
      idx.ingest(
        makeEvent({
          message: 'fix: null deref',
          files: [{ path: 'src/b.ts', added: 1, deleted: 0 }],
        }),
      );
      // Non-bug commit
      idx.ingest(
        makeEvent({
          message: 'refactor: rename var',
          files: [{ path: 'src/b.ts', added: 1, deleted: 0 }],
        }),
      );

      const stats = idx.statsFor('src/b.ts');
      expect(stats).not.toBeNull();
      expect(stats!.commits).toBe(2);
      expect(stats!.bugCommits).toBe(1);
      expect(stats!.bugDensity).toBeCloseTo(0.5, 5);
    });

    it('matches "fix:" prefix', () => {
      const idx = new ChurnIndex();
      idx.ingest(makeEvent({ message: 'fix: null deref', files: [{ path: 'f.ts', added: 1, deleted: 0 }] }));
      expect(idx.statsFor('f.ts')!.bugCommits).toBe(1);
    });

    it('matches "bug" keyword', () => {
      const idx = new ChurnIndex();
      idx.ingest(makeEvent({ message: 'fix bug in parser', files: [{ path: 'f.ts', added: 1, deleted: 0 }] }));
      expect(idx.statsFor('f.ts')!.bugCommits).toBe(1);
    });

    it('matches "hotfix" keyword', () => {
      const idx = new ChurnIndex();
      idx.ingest(makeEvent({ message: 'hotfix: security patch', files: [{ path: 'f.ts', added: 1, deleted: 0 }] }));
      expect(idx.statsFor('f.ts')!.bugCommits).toBe(1);
    });

    it('matches "revert" keyword', () => {
      const idx = new ChurnIndex();
      idx.ingest(makeEvent({ message: 'revert: bad deploy', files: [{ path: 'f.ts', added: 1, deleted: 0 }] }));
      expect(idx.statsFor('f.ts')!.bugCommits).toBe(1);
    });

    it('does NOT match "refactor" keyword', () => {
      const idx = new ChurnIndex();
      idx.ingest(makeEvent({ message: 'refactor: rename var', files: [{ path: 'f.ts', added: 1, deleted: 0 }] }));
      expect(idx.statsFor('f.ts')!.bugCommits).toBe(0);
    });

    it('bugDensity equals bugCommits / commits', () => {
      const idx = new ChurnIndex();
      idx.ingest(makeEvent({ message: 'fix: issue', files: [{ path: 'g.ts', added: 1, deleted: 0 }] }));
      idx.ingest(makeEvent({ message: 'fix: issue', files: [{ path: 'g.ts', added: 1, deleted: 0 }] }));
      idx.ingest(makeEvent({ message: 'feat: add thing', files: [{ path: 'g.ts', added: 1, deleted: 0 }] }));
      idx.ingest(makeEvent({ message: 'feat: add thing', files: [{ path: 'g.ts', added: 1, deleted: 0 }] }));

      const stats = idx.statsFor('g.ts')!;
      expect(stats.bugCommits).toBe(2);
      expect(stats.commits).toBe(4);
      expect(stats.bugDensity).toBeCloseTo(0.5, 5);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Author entropy
  // -------------------------------------------------------------------------
  describe('author entropy', () => {
    it('single author exclusively → authorEntropy === 0', () => {
      const idx = new ChurnIndex();

      for (let i = 0; i < 5; i++) {
        idx.ingest(
          makeEvent({
            author: 'alice',
            authorEmail: 'alice@example.com',
            files: [{ path: 'src/c.ts', added: 5, deleted: 0 }],
          }),
        );
      }

      const stats = idx.statsFor('src/c.ts');
      expect(stats).not.toBeNull();
      expect(stats!.authorEntropy).toBe(0);
    });

    it('two authors with equal share → authorEntropy ≈ 1.0 (base-2 Shannon)', () => {
      const idx = new ChurnIndex();

      // alice: 3 commits, bob: 3 commits → equal share → H = 1.0
      for (let i = 0; i < 3; i++) {
        idx.ingest(
          makeEvent({
            author: 'alice',
            authorEmail: 'alice@example.com',
            files: [{ path: 'src/d.ts', added: 5, deleted: 0 }],
          }),
        );
      }
      for (let i = 0; i < 3; i++) {
        idx.ingest(
          makeEvent({
            author: 'bob',
            authorEmail: 'bob@example.com',
            files: [{ path: 'src/d.ts', added: 5, deleted: 0 }],
          }),
        );
      }

      const stats = idx.statsFor('src/d.ts');
      expect(stats).not.toBeNull();
      // H = -(0.5 * log2(0.5) + 0.5 * log2(0.5)) = 1.0
      expect(stats!.authorEntropy).toBeCloseTo(1.0, 5);
    });
  });

  // -------------------------------------------------------------------------
  // 4. lastTouch
  // -------------------------------------------------------------------------
  describe('lastTouch', () => {
    it('lastTouch is the timestamp of the most recent event touching that file', () => {
      const idx = new ChurnIndex();

      const older = NOW - 1000;
      const newer = NOW - 100;
      const newest = NOW - 10;

      idx.ingest(makeEvent({ timestamp: older, files: [{ path: 'src/e.ts', added: 1, deleted: 0 }] }));
      idx.ingest(makeEvent({ timestamp: newest, files: [{ path: 'src/e.ts', added: 1, deleted: 0 }] }));
      idx.ingest(makeEvent({ timestamp: newer, files: [{ path: 'src/e.ts', added: 1, deleted: 0 }] }));

      const stats = idx.statsFor('src/e.ts');
      expect(stats).not.toBeNull();
      expect(stats!.lastTouch).toBe(newest);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Snapshot round-trip
  // -------------------------------------------------------------------------
  describe('snapshot round-trip', () => {
    it('snapshot() → ChurnIndex.load(s) → statsFor returns identical values', () => {
      const idx = new ChurnIndex();

      idx.ingest(makeEvent({
        author: 'alice',
        authorEmail: 'alice@example.com',
        message: 'fix: crash',
        timestamp: NOW - 500,
        files: [{ path: 'src/f.ts', added: 8, deleted: 3 }],
      }));
      idx.ingest(makeEvent({
        author: 'bob',
        authorEmail: 'bob@example.com',
        message: 'feat: cool thing',
        timestamp: NOW - 100,
        files: [{ path: 'src/f.ts', added: 4, deleted: 1 }],
      }));

      const snap = idx.snapshot();
      const restored = ChurnIndex.load(snap);

      const original = idx.statsFor('src/f.ts')!;
      const fromSnap = restored.statsFor('src/f.ts')!;

      expect(fromSnap).not.toBeNull();
      expect(fromSnap.node).toBe(original.node);
      expect(fromSnap.commits).toBe(original.commits);
      expect(fromSnap.churnLines).toBe(original.churnLines);
      expect(fromSnap.bugCommits).toBe(original.bugCommits);
      expect(fromSnap.bugDensity).toBeCloseTo(original.bugDensity, 5);
      expect(fromSnap.authorEntropy).toBeCloseTo(original.authorEntropy, 5);
      expect(fromSnap.lastTouch).toBe(original.lastTouch);
    });

    it('snapshot() returns a deep copy — mutating snapshot does not affect the index', () => {
      const idx = new ChurnIndex();
      idx.ingest(makeEvent({
        files: [{ path: 'src/g.ts', added: 5, deleted: 5 }],
      }));

      const snap = idx.snapshot();
      // Mutate snapshot
      snap.nodes['src/g.ts']!.commits = 9999;

      // Index should be unaffected
      expect(idx.statsFor('src/g.ts')!.commits).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Unknown node
  // -------------------------------------------------------------------------
  describe('unknown node', () => {
    it('statsFor returns null for nonexistent node', () => {
      const idx = new ChurnIndex();
      expect(idx.statsFor('nonexistent.ts')).toBeNull();
    });
  });
});
