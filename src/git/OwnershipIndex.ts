/**
 * OwnershipIndex
 *
 * Tracks blame-weighted file ownership from git history. Each commit
 * contributes weight = (added + deleted) for each file it touches.
 * Zero-line touches are skipped (no ownership contribution).
 *
 * Design notes:
 * - share = authorWeight / totalWeight (all shares sum to 1)
 * - owners sorted descending by share
 * - busFactor = min k such that top-k owners cover ≥50% share
 * - stalenessDays = Math.floor((now - lastTouch) / 86400)
 * - snapshot() returns a deep copy; load() restores from that copy
 */

import type { GitCommitEvent } from './GitHistoryMiner.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OwnerShare {
  author: string;
  email: string;
  /** 0..1; all shares sum to 1 */
  share: number;
}

export interface OwnershipStats {
  node: string;
  /** Sorted descending by share */
  owners: OwnerShare[];
  /** Days since lastTouch */
  stalenessDays: number;
  /** Min k such that top-k owners cover ≥50% share */
  busFactor: number;
}

export type OwnershipSnapshot = {
  version: 1;
  nodes: Record<string, OwnershipRaw>;
};

// ---------------------------------------------------------------------------
// Internal types (not exported)
// ---------------------------------------------------------------------------

interface AuthorEntry {
  author: string;
  email: string;
  weight: number;
}

interface OwnershipRaw {
  /** author email → { author, email, weight } */
  authorWeights: Record<string, AuthorEntry>;
  lastTouch: number;
}

// ---------------------------------------------------------------------------
// OwnershipIndex
// ---------------------------------------------------------------------------

export class OwnershipIndex {
  private readonly nodes: Map<string, OwnershipRaw> = new Map();

  /**
   * Process one commit event. For each file, accumulate line-weighted
   * authorship. Files with added + deleted === 0 are skipped.
   */
  ingest(event: GitCommitEvent): void {
    for (const file of event.files) {
      const lineWeight = file.added + file.deleted;
      // Skip zero-line touches — they contribute no ownership.
      if (lineWeight === 0) continue;

      const raw = this.getOrCreate(file.path);

      const existing = raw.authorWeights[event.authorEmail];
      const updatedEntry: AuthorEntry = {
        author: event.author,
        email: event.authorEmail,
        weight: (existing?.weight ?? 0) + lineWeight,
      };

      const updated: OwnershipRaw = {
        authorWeights: {
          ...raw.authorWeights,
          [event.authorEmail]: updatedEntry,
        },
        lastTouch: Math.max(raw.lastTouch, event.timestamp),
      };

      this.nodes.set(file.path, updated);
    }
  }

  /**
   * Return ownership stats for the given node, or null if unknown.
   *
   * @param now - Unix seconds; defaults to Date.now()/1000. Provided for
   *              testability so callers can pass a controlled timestamp.
   */
  statsFor(node: string, now?: number): OwnershipStats | null {
    const raw = this.nodes.get(node);
    if (raw === undefined) return null;

    const currentNow = now ?? Math.floor(Date.now() / 1000);

    const totalWeight = Object.values(raw.authorWeights).reduce(
      (sum, e) => sum + e.weight,
      0,
    );

    const owners: OwnerShare[] = Object.values(raw.authorWeights)
      .map((e) => ({
        author: e.author,
        email: e.email,
        share: totalWeight > 0 ? e.weight / totalWeight : 0,
      }))
      .sort((a, b) => b.share - a.share);

    const stalenessDays = Math.floor((currentNow - raw.lastTouch) / 86400);
    const busFactor = computeBusFactor(owners);

    return {
      node,
      owners,
      stalenessDays,
      busFactor,
    };
  }

  /**
   * Return a deep-copy snapshot of all internal state for persistence.
   */
  snapshot(): OwnershipSnapshot {
    const nodes: Record<string, OwnershipRaw> = {};
    for (const [path, raw] of this.nodes) {
      const authorWeights: Record<string, AuthorEntry> = {};
      for (const [email, entry] of Object.entries(raw.authorWeights)) {
        authorWeights[email] = { ...entry };
      }
      nodes[path] = { authorWeights, lastTouch: raw.lastTouch };
    }
    return { version: 1, nodes };
  }

  /**
   * Restore an OwnershipIndex from a previously obtained snapshot.
   */
  static load(s: OwnershipSnapshot): OwnershipIndex {
    const idx = new OwnershipIndex();
    for (const [path, raw] of Object.entries(s.nodes)) {
      const authorWeights: Record<string, AuthorEntry> = {};
      for (const [email, entry] of Object.entries(raw.authorWeights)) {
        authorWeights[email] = { ...entry };
      }
      idx.nodes.set(path, { authorWeights, lastTouch: raw.lastTouch });
    }
    return idx;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getOrCreate(path: string): OwnershipRaw {
    const existing = this.nodes.get(path);
    if (existing !== undefined) return existing;

    const fresh: OwnershipRaw = { authorWeights: {}, lastTouch: 0 };
    this.nodes.set(path, fresh);
    return fresh;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Compute the bus factor: minimum k such that the top-k owners (sorted
 * descending by share) collectively cover at least 50% of total share.
 *
 * Assumes owners is already sorted descending by share.
 */
function computeBusFactor(owners: OwnerShare[]): number {
  let cumulative = 0;
  for (let k = 0; k < owners.length; k++) {
    cumulative += owners[k]!.share;
    if (cumulative >= 0.5) return k + 1;
  }
  // Fallback: all owners needed (shouldn't happen when shares sum to 1).
  return owners.length;
}
