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
export declare class OwnershipIndex {
    private readonly nodes;
    /**
     * Process one commit event. For each file, accumulate line-weighted
     * authorship. Files with added + deleted === 0 are skipped.
     */
    ingest(event: GitCommitEvent): void;
    /**
     * Return ownership stats for the given node, or null if unknown.
     *
     * @param now - Unix seconds; defaults to Date.now()/1000. Provided for
     *              testability so callers can pass a controlled timestamp.
     */
    statsFor(node: string, now?: number): OwnershipStats | null;
    /**
     * Return a deep-copy snapshot of all internal state for persistence.
     */
    snapshot(): OwnershipSnapshot;
    /**
     * Restore an OwnershipIndex from a previously obtained snapshot.
     */
    static load(s: OwnershipSnapshot): OwnershipIndex;
    private getOrCreate;
}
export {};
//# sourceMappingURL=OwnershipIndex.d.ts.map