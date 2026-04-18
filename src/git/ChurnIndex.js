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
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BUG_REGEX = /\b(fix|bug|hotfix|revert)\b/i;
// ---------------------------------------------------------------------------
// ChurnIndex
// ---------------------------------------------------------------------------
export class ChurnIndex {
    nodes = new Map();
    /**
     * Process one commit event. For each file in the event, accumulate
     * churn metrics into that file's ChurnRaw entry.
     */
    ingest(event) {
        const isBug = BUG_REGEX.test(event.message);
        for (const file of event.files) {
            const raw = this.getOrCreate(file.path);
            const updated = {
                commits: raw.commits + 1,
                churnLines: raw.churnLines + file.added + file.deleted,
                bugCommits: raw.bugCommits + (isBug ? 1 : 0),
                authorCounts: {
                    ...raw.authorCounts,
                    [event.authorEmail]: (raw.authorCounts[event.authorEmail] ?? 0) + 1,
                },
                lastTouch: Math.max(raw.lastTouch, event.timestamp),
            };
            this.nodes.set(file.path, updated);
        }
    }
    /**
     * Return computed stats for the given node, or null if unknown.
     */
    statsFor(node) {
        const raw = this.nodes.get(node);
        if (raw === undefined)
            return null;
        const bugDensity = raw.commits > 0 ? raw.bugCommits / raw.commits : 0;
        const authorEntropy = computeShannonEntropy(raw.authorCounts);
        return {
            node,
            commits: raw.commits,
            churnLines: raw.churnLines,
            bugCommits: raw.bugCommits,
            bugDensity,
            authorEntropy,
            lastTouch: raw.lastTouch,
        };
    }
    /**
     * Return a deep-copy snapshot of all internal state for persistence.
     */
    snapshot() {
        const nodes = {};
        for (const [path, raw] of this.nodes) {
            nodes[path] = {
                commits: raw.commits,
                churnLines: raw.churnLines,
                bugCommits: raw.bugCommits,
                authorCounts: { ...raw.authorCounts },
                lastTouch: raw.lastTouch,
            };
        }
        return { version: 1, nodes };
    }
    /**
     * Restore a ChurnIndex from a previously obtained snapshot.
     */
    static load(s) {
        const idx = new ChurnIndex();
        for (const [path, raw] of Object.entries(s.nodes)) {
            idx.nodes.set(path, {
                commits: raw.commits,
                churnLines: raw.churnLines,
                bugCommits: raw.bugCommits,
                authorCounts: { ...raw.authorCounts },
                lastTouch: raw.lastTouch,
            });
        }
        return idx;
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    getOrCreate(path) {
        const existing = this.nodes.get(path);
        if (existing !== undefined)
            return existing;
        const fresh = {
            commits: 0,
            churnLines: 0,
            bugCommits: 0,
            authorCounts: {},
            lastTouch: 0,
        };
        this.nodes.set(path, fresh);
        return fresh;
    }
}
// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
/**
 * Compute Shannon entropy (base-2) from a map of category → count.
 * Returns 0 when there is only one category (or none).
 */
function computeShannonEntropy(counts) {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total === 0)
        return 0;
    let entropy = 0;
    for (const count of Object.values(counts)) {
        if (count === 0)
            continue;
        const p = count / total;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}
//# sourceMappingURL=ChurnIndex.js.map