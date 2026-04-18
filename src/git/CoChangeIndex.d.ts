/**
 * CoChangeIndex
 *
 * Sparse pair matrix tracking which files co-change together across git
 * history. Provides Jaccard similarity and recency-decayed confidence
 * scores for co-change coupling analysis.
 *
 * Key design decisions:
 * - Pair key is "${nodeA}\0${nodeB}" where nodeA <= nodeB (lexicographic)
 * - Confidence = jaccard * log1p(sharedCommits) * exp(-ln2 * ageDays / halfLifeDays)
 * - topFor hard-filters pairs with sharedCommits < 3 (noise floor)
 * - isBulk and isMerge events are silently skipped
 */
import type { GitCommitEvent } from './GitHistoryMiner.js';
export interface CoChangeStats {
    nodeA: string;
    nodeB: string;
    sharedCommits: number;
    countA: number;
    countB: number;
    lastSharedTimestamp: number;
    jaccard: number;
}
export interface CoChangeQuery {
    node: string;
    limit?: number;
    minConfidence?: number;
    now?: number;
    halfLifeDays?: number;
}
export type CoChangeSnapshot = {
    version: 1;
    pairs: CoChangeStats[];
    nodeCounts: Record<string, number>;
};
export declare class CoChangeIndex {
    private readonly pairMap;
    private readonly nodeCounts;
    /**
     * Process one commit. Skips isBulk and isMerge events.
     */
    ingest(event: GitCommitEvent): void;
    /**
     * Top co-changed nodes for `node`, sorted by descending confidence.
     */
    topFor(q: CoChangeQuery): Array<CoChangeStats & {
        confidence: number;
    }>;
    /**
     * All pairs for `node`, unsorted, no minimum filter.
     */
    allFor(node: string): CoChangeStats[];
    /**
     * Serialise to a plain object for JSON persistence.
     * Returns a deep copy — mutations to the returned object do not affect the index.
     */
    snapshot(): CoChangeSnapshot;
    /**
     * Restore from a snapshot.
     */
    static load(s: CoChangeSnapshot): CoChangeIndex;
    /**
     * Diagnostic counts.
     */
    size(): {
        nodes: number;
        pairs: number;
    };
    private updatePair;
    private pairsForNode;
}
//# sourceMappingURL=CoChangeIndex.d.ts.map