/**
 * GitHistoryMiner
 *
 * Streams typed commit events from `git log --numstat`, providing
 * co-change coupling, churn, and ownership data for the graph layer.
 *
 * Uses simple-git for subprocess management. The git log format uses
 * null-byte field separators and a leading ASCII Record Separator (\x1e)
 * on each commit header so the raw output can be split unambiguously even
 * when author names, emails, or messages contain newlines.
 *
 * Output layout per commit:
 *   \x1e<sha>\x00<author>\x00<email>\x00<timestamp>\x00<subject>\x00<parents>\n
 *   \n
 *   <added>\t<deleted>\t<path>\n
 *   ...
 *
 * Splitting on \x1e gives: ['', record0, record1, ...] where each record
 * starts with the header line followed by a blank line and numstat lines.
 */
export interface GitCommitEvent {
    sha: string;
    author: string;
    authorEmail: string;
    /** Unix epoch seconds */
    timestamp: number;
    message: string;
    files: Array<{
        path: string;
        added: number;
        deleted: number;
    }>;
    isMerge: boolean;
    isBulk: boolean;
}
export interface MinerOptions {
    /** How far back to look. Defaults to 365 days. Ignored when sinceSha is set. */
    sinceDays?: number;
    /** Incremental mode: only yield commits reachable from HEAD but not from this SHA. */
    sinceSha?: string;
    /** Commits touching more files than this threshold are flagged isBulk. Default 50. */
    bulkThreshold?: number;
    /** File path prefixes to exclude from the files array. */
    excludePaths?: string[];
}
export declare class GitHistoryMiner {
    private readonly repoRoot;
    constructor(repoRoot: string);
    /**
     * Stream commit events from newest to oldest.
     *
     * The generator yields one GitCommitEvent per non-empty commit. Binary
     * files (numstat shows `-\t-\t<path>`) are skipped. Files matching any
     * excludePaths prefix are omitted from the files array.
     */
    stream(opts?: MinerOptions): AsyncIterable<GitCommitEvent>;
    /** Return the full 40-character SHA of HEAD. */
    headSha(): Promise<string>;
    private buildLogArgs;
    private fetchRawLogStream;
    private parseRecord;
    private buildEvent;
    private parseNumstat;
}
//# sourceMappingURL=GitHistoryMiner.d.ts.map