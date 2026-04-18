/**
 * GitOverlayStore
 *
 * Coordinator class that drives GitHistoryMiner and fans each GitCommitEvent
 * into CoChangeIndex, ChurnIndex, and OwnershipIndex. Handles full rebuilds,
 * incremental refresh (only commits since lastCommitScanned), and persistence
 * via a `.ctxloom/git-overlay.json` sidecar file.
 *
 * Sidecar format:
 * {
 *   "version": 1,
 *   "lastCommitScanned": "<sha or null>",
 *   "commits": 42,
 *   "windowDays": 365,
 *   "coChange": { CoChangeSnapshot },
 *   "churn": { ChurnSnapshot },
 *   "ownership": { OwnershipSnapshot }
 * }
 */
import { CoChangeIndex } from './CoChangeIndex.js';
import { ChurnIndex } from './ChurnIndex.js';
import { OwnershipIndex } from './OwnershipIndex.js';
export interface OverlayBootstrapOptions {
    /** How far back to mine git history. Defaults to 365 days. */
    windowDays?: number;
    /** Commits touching more files than this threshold are flagged isBulk. Defaults to 50. */
    bulkThreshold?: number;
    /** Extra path prefixes to exclude (merged with miner defaults). */
    excludePaths?: string[];
}
export interface RefreshResult {
    commitsIngested: number;
    newHead: string;
}
export declare class GitOverlayStore {
    #private;
    private readonly repoRoot;
    get coChange(): CoChangeIndex;
    get churn(): ChurnIndex;
    get ownership(): OwnershipIndex;
    private lastCommitScanned;
    private totalCommits;
    private readonly windowDays;
    private readonly bulkThreshold;
    private readonly excludePaths;
    constructor(repoRoot: string, opts?: OverlayBootstrapOptions);
    /**
     * Full rebuild: reset all indices then mine the full window and fan every
     * event into all three indices.
     */
    rebuild(): Promise<void>;
    /**
     * Incremental update: mine only commits since lastCommitScanned, fan into
     * all three indices, update the head pointer.
     *
     * Falls back to a full rebuild when lastCommitScanned is null.
     */
    refresh(): Promise<RefreshResult>;
    /**
     * Persist all indices and metadata to `.ctxloom/git-overlay.json`.
     */
    saveSnapshot(): Promise<void>;
    /**
     * Load state from `.ctxloom/git-overlay.json`.
     * Returns `false` if the file does not exist; `true` on success.
     */
    loadSnapshot(): Promise<boolean>;
    /**
     * Return diagnostic stats for the current store state.
     */
    stats(): {
        commits: number;
        lastCommit: string | null;
        windowDays: number;
    };
    private createMiner;
    private sidecarPath;
    private ingestStream;
    private safeHeadSha;
}
//# sourceMappingURL=GitOverlayStore.d.ts.map