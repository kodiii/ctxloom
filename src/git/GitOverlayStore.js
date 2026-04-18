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
import path from 'node:path';
import fs from 'node:fs/promises';
import { GitHistoryMiner } from './GitHistoryMiner.js';
import { CoChangeIndex } from './CoChangeIndex.js';
import { ChurnIndex } from './ChurnIndex.js';
import { OwnershipIndex } from './OwnershipIndex.js';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_WINDOW_DAYS = 365;
const DEFAULT_BULK_THRESHOLD = 50;
const SIDECAR_SUBPATH = path.join('.ctxloom', 'git-overlay.json');
// ---------------------------------------------------------------------------
// GitOverlayStore
// ---------------------------------------------------------------------------
export class GitOverlayStore {
    repoRoot;
    #coChange = new CoChangeIndex();
    #churn = new ChurnIndex();
    #ownership = new OwnershipIndex();
    get coChange() { return this.#coChange; }
    get churn() { return this.#churn; }
    get ownership() { return this.#ownership; }
    lastCommitScanned = null;
    totalCommits = 0;
    windowDays;
    bulkThreshold;
    excludePaths;
    constructor(repoRoot, opts = {}) {
        this.repoRoot = repoRoot;
        this.windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
        this.bulkThreshold = opts.bulkThreshold ?? DEFAULT_BULK_THRESHOLD;
        this.excludePaths = opts.excludePaths;
    }
    /**
     * Full rebuild: reset all indices then mine the full window and fan every
     * event into all three indices.
     */
    async rebuild() {
        this.#coChange = new CoChangeIndex();
        this.#churn = new ChurnIndex();
        this.#ownership = new OwnershipIndex();
        this.totalCommits = 0;
        this.lastCommitScanned = null;
        const miner = this.createMiner();
        const count = await this.ingestStream(miner.stream({
            sinceDays: this.windowDays,
            bulkThreshold: this.bulkThreshold,
            excludePaths: this.excludePaths,
        }));
        this.totalCommits = count;
        this.lastCommitScanned = await this.safeHeadSha(miner);
    }
    /**
     * Incremental update: mine only commits since lastCommitScanned, fan into
     * all three indices, update the head pointer.
     *
     * Falls back to a full rebuild when lastCommitScanned is null.
     */
    async refresh() {
        if (this.lastCommitScanned === null) {
            await this.rebuild();
            return {
                commitsIngested: this.totalCommits,
                newHead: this.lastCommitScanned ?? '',
            };
        }
        const miner = this.createMiner();
        const count = await this.ingestStream(miner.stream({
            sinceSha: this.lastCommitScanned,
            bulkThreshold: this.bulkThreshold,
            excludePaths: this.excludePaths,
        }));
        const newHead = await this.safeHeadSha(miner);
        this.totalCommits += count;
        this.lastCommitScanned = newHead;
        return { commitsIngested: count, newHead };
    }
    /**
     * Persist all indices and metadata to `.ctxloom/git-overlay.json`.
     */
    async saveSnapshot() {
        const sidecarPath = this.sidecarPath();
        await fs.mkdir(path.dirname(sidecarPath), { recursive: true });
        const data = {
            version: 1,
            lastCommitScanned: this.lastCommitScanned,
            commits: this.totalCommits,
            windowDays: this.windowDays,
            coChange: this.#coChange.snapshot(),
            churn: this.#churn.snapshot(),
            ownership: this.#ownership.snapshot(),
        };
        await fs.writeFile(sidecarPath, JSON.stringify(data, null, 2), 'utf8');
    }
    /**
     * Load state from `.ctxloom/git-overlay.json`.
     * Returns `false` if the file does not exist; `true` on success.
     */
    async loadSnapshot() {
        const sidecarPath = this.sidecarPath();
        let raw;
        try {
            raw = await fs.readFile(sidecarPath, 'utf8');
        }
        catch (err) {
            if (isEnoent(err))
                return false;
            throw err;
        }
        const data = JSON.parse(raw);
        if (data.version !== 1) {
            throw new Error(`GitOverlayStore: unsupported sidecar version ${data.version}`);
        }
        this.#coChange = CoChangeIndex.load(data.coChange);
        this.#churn = ChurnIndex.load(data.churn);
        this.#ownership = OwnershipIndex.load(data.ownership);
        this.lastCommitScanned = data.lastCommitScanned;
        this.totalCommits = data.commits;
        return true;
    }
    /**
     * Return diagnostic stats for the current store state.
     */
    stats() {
        return {
            commits: this.totalCommits,
            lastCommit: this.lastCommitScanned,
            windowDays: this.windowDays,
        };
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    createMiner() {
        return new GitHistoryMiner(this.repoRoot);
    }
    sidecarPath() {
        return path.join(this.repoRoot, SIDECAR_SUBPATH);
    }
    async ingestStream(stream) {
        let count = 0;
        for await (const event of stream) {
            this.#coChange.ingest(event);
            this.#churn.ingest(event);
            this.#ownership.ingest(event);
            count++;
        }
        return count;
    }
    async safeHeadSha(miner) {
        try {
            return await miner.headSha();
        }
        catch {
            // Empty repo has no HEAD — return null gracefully
            return null;
        }
    }
}
// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
function isEnoent(err) {
    return (err instanceof Error &&
        'code' in err &&
        err.code === 'ENOENT');
}
//# sourceMappingURL=GitOverlayStore.js.map