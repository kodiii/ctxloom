/**
 * Tests for OwnershipIndex — blame-weighted ownership, staleness, bus-factor.
 */
import { describe, it, expect } from 'vitest';
import { OwnershipIndex } from '../src/git/OwnershipIndex.js';
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

describe('OwnershipIndex', () => {
  // -------------------------------------------------------------------------
  // 1. Owner shares
  // -------------------------------------------------------------------------
  describe('owner shares', () => {
    it('computes shares sorted descending by weight', () => {
      const idx = new OwnershipIndex();

      // alice: 2 commits × 20 lines each = 40 total weight
      idx.ingest(makeEvent({
        author: 'alice',
        authorEmail: 'alice@example.com',
        files: [{ path: 'src/a.ts', added: 15, deleted: 5 }], // 20 lines
      }));
      idx.ingest(makeEvent({
        author: 'alice',
        authorEmail: 'alice@example.com',
        files: [{ path: 'src/a.ts', added: 15, deleted: 5 }], // 20 lines
      }));
      // bob: 1 commit × 10 lines = 10 total weight
      idx.ingest(makeEvent({
        author: 'bob',
        authorEmail: 'bob@example.com',
        files: [{ path: 'src/a.ts', added: 8, deleted: 2 }], // 10 lines
      }));

      const stats = idx.statsFor('src/a.ts');
      expect(stats).not.toBeNull();

      const owners = stats!.owners;
      expect(owners).toHaveLength(2);

      // alice has 40/50 ≈ 0.8
      expect(owners[0]!.author).toBe('alice');
      expect(owners[0]!.email).toBe('alice@example.com');
      expect(owners[0]!.share).toBeCloseTo(40 / 50, 5);

      // bob has 10/50 = 0.2
      expect(owners[1]!.author).toBe('bob');
      expect(owners[1]!.email).toBe('bob@example.com');
      expect(owners[1]!.share).toBeCloseTo(10 / 50, 5);

      // Shares sum to 1
      const totalShare = owners.reduce((s, o) => s + o.share, 0);
      expect(totalShare).toBeCloseTo(1.0, 5);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Weight by lines — zero-line touches contribute no ownership
  // -------------------------------------------------------------------------
  describe('weight by lines', () => {
    it('a commit with added=0, deleted=0 contributes no ownership shift', () => {
      const idx = new OwnershipIndex();

      // alice owns via a real commit
      idx.ingest(makeEvent({
        author: 'alice',
        authorEmail: 'alice@example.com',
        files: [{ path: 'src/b.ts', added: 10, deleted: 0 }],
      }));

      // bob touches with zero lines — should not shift ownership
      idx.ingest(makeEvent({
        author: 'bob',
        authorEmail: 'bob@example.com',
        files: [{ path: 'src/b.ts', added: 0, deleted: 0 }],
      }));

      const stats = idx.statsFor('src/b.ts')!;
      expect(stats.owners).toHaveLength(1);
      expect(stats.owners[0]!.author).toBe('alice');
      expect(stats.owners[0]!.share).toBeCloseTo(1.0, 5);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Bus factor
  // -------------------------------------------------------------------------
  describe('busFactor', () => {
    it('single owner with 100% share → busFactor === 1', () => {
      const idx = new OwnershipIndex();
      idx.ingest(makeEvent({
        author: 'alice',
        authorEmail: 'alice@example.com',
        files: [{ path: 'src/c.ts', added: 20, deleted: 0 }],
      }));

      const stats = idx.statsFor('src/c.ts')!;
      expect(stats.busFactor).toBe(1);
    });

    it('4 equal owners at 25% each → busFactor === 2', () => {
      const idx = new OwnershipIndex();
      const authors = ['alice', 'bob', 'carol', 'dave'];

      for (const name of authors) {
        // Each contributes exactly 10 lines so shares are equal
        idx.ingest(makeEvent({
          author: name,
          authorEmail: `${name}@example.com`,
          files: [{ path: 'src/d.ts', added: 10, deleted: 0 }],
        }));
      }

      const stats = idx.statsFor('src/d.ts')!;
      expect(stats.owners).toHaveLength(4);
      // Top-1 owner covers 25% (<50%), top-2 covers 50% (≥50%) → busFactor = 2
      expect(stats.busFactor).toBe(2);
    });

    it('two owners at 60%/40% → busFactor === 1', () => {
      const idx = new OwnershipIndex();

      idx.ingest(makeEvent({
        author: 'alice',
        authorEmail: 'alice@example.com',
        files: [{ path: 'src/e.ts', added: 60, deleted: 0 }],
      }));
      idx.ingest(makeEvent({
        author: 'bob',
        authorEmail: 'bob@example.com',
        files: [{ path: 'src/e.ts', added: 40, deleted: 0 }],
      }));

      const stats = idx.statsFor('src/e.ts')!;
      // alice alone covers 60% ≥ 50% → busFactor = 1
      expect(stats.busFactor).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. stalenessDays
  // -------------------------------------------------------------------------
  describe('stalenessDays', () => {
    it('equals Math.floor((now - lastTouch) / 86400)', () => {
      const idx = new OwnershipIndex();

      const lastTouch = NOW - 5 * 86400 - 3600; // 5 days + 1 hour ago
      idx.ingest(makeEvent({
        timestamp: lastTouch,
        files: [{ path: 'src/f.ts', added: 10, deleted: 0 }],
      }));

      const stats = idx.statsFor('src/f.ts', NOW)!;
      const expectedDays = Math.floor((NOW - lastTouch) / 86400);
      expect(stats.stalenessDays).toBe(expectedDays);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Snapshot round-trip
  // -------------------------------------------------------------------------
  describe('snapshot round-trip', () => {
    it('snapshot() → OwnershipIndex.load(s) → statsFor returns identical results', () => {
      const idx = new OwnershipIndex();

      idx.ingest(makeEvent({
        author: 'alice',
        authorEmail: 'alice@example.com',
        timestamp: NOW - 100,
        files: [{ path: 'src/g.ts', added: 20, deleted: 5 }],
      }));
      idx.ingest(makeEvent({
        author: 'bob',
        authorEmail: 'bob@example.com',
        timestamp: NOW - 50,
        files: [{ path: 'src/g.ts', added: 10, deleted: 2 }],
      }));

      const snap = idx.snapshot();
      const restored = OwnershipIndex.load(snap);

      const original = idx.statsFor('src/g.ts', NOW)!;
      const fromSnap = restored.statsFor('src/g.ts', NOW)!;

      expect(fromSnap).not.toBeNull();
      expect(fromSnap.owners).toHaveLength(original.owners.length);

      for (let i = 0; i < original.owners.length; i++) {
        expect(fromSnap.owners[i]!.author).toBe(original.owners[i]!.author);
        expect(fromSnap.owners[i]!.email).toBe(original.owners[i]!.email);
        expect(fromSnap.owners[i]!.share).toBeCloseTo(original.owners[i]!.share, 5);
      }

      expect(fromSnap.stalenessDays).toBe(original.stalenessDays);
      expect(fromSnap.busFactor).toBe(original.busFactor);
    });

    it('snapshot() returns a deep copy — mutating snapshot does not affect the index', () => {
      const idx = new OwnershipIndex();
      idx.ingest(makeEvent({
        author: 'alice',
        authorEmail: 'alice@example.com',
        files: [{ path: 'src/h.ts', added: 10, deleted: 0 }],
      }));

      const snap = idx.snapshot();
      // Mutate snapshot raw data
      snap.nodes['src/h.ts']!.lastTouch = 0;

      // Index should be unaffected
      const stats = idx.statsFor('src/h.ts', NOW)!;
      expect(stats.stalenessDays).toBeLessThan(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Unknown node
  // -------------------------------------------------------------------------
  describe('unknown node', () => {
    it('statsFor returns null for nonexistent node', () => {
      const idx = new OwnershipIndex();
      expect(idx.statsFor('nonexistent.ts')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 7. allNodes
  // -------------------------------------------------------------------------
  it('allNodes returns all tracked file paths', () => {
    const idx = new OwnershipIndex();
    const event = (path: string) => ({
      sha: 'abc', author: 'Alice', authorEmail: 'alice@x.com',
      timestamp: 1_000_000, message: '',
      files: [{ path, added: 5, deleted: 0 }],
      isBulk: false, isMerge: false,
    });
    idx.ingest(event('src/a.ts'));
    idx.ingest(event('src/b.ts'));
    expect(idx.allNodes().sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
