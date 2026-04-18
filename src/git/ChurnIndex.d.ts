/**
 * ChurnIndex
 *
 * Per-node accumulator tracking code churn, bug-fix commit density, and
 * author entropy for every file touched by ingested GitCommitEvents.
 *
 * Design notes:
 * - churnLines = Σ (added + deleted) across all touching commits
 * - bugCommits uses /\b(fix|bug|hotfix|revert)\b/i against commit message
 * - authorEntropy = Shannon H (base-2) over per-author commit-count shares
 * - snapshot() returns a deep copy; load() restores from that copy
 */
import type { GitCommitEvent } from './GitHistoryMiner.js';
export interface ChurnStats {
    node: string;
    commits: number;
    /** Sum of (added + deleted) across all touching commits. */
    churnLines: number;
    bugCommits: number;
    /** bugCommits / commits */
    bugDensity: number;
    /** Shannon entropy (base-2) over author share distribution. */
    authorEntropy: number;
    /** Unix seconds of the most recent touching commit. */
    lastTouch: number;
}
export type ChurnSnapshot = {
    version: 1;
    nodes: Record<string, ChurnRaw>;
};
interface ChurnRaw {
    commits: number;
    churnLines: number;
    bugCommits: number;
    /** author email → commit count touching this node */
    authorCounts: Record<string, number>;
    lastTouch: number;
}
export declare class ChurnIndex {
    private readonly nodes;
    /**
     * Process one commit event. For each file in the event, accumulate
     * churn metrics into that file's ChurnRaw entry.
     */
    ingest(event: GitCommitEvent): void;
    /**
     * Return computed stats for the given node, or null if unknown.
     */
    statsFor(node: string): ChurnStats | null;
    /**
     * Return a deep-copy snapshot of all internal state for persistence.
     */
    snapshot(): ChurnSnapshot;
    /**
     * Restore a ChurnIndex from a previously obtained snapshot.
     */
    static load(s: ChurnSnapshot): ChurnIndex;
    private getOrCreate;
}
export {};
//# sourceMappingURL=ChurnIndex.d.ts.map