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
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_CONFIDENCE = 0.05;
const DEFAULT_HALF_LIFE_DAYS = 90;
const MIN_SHARED_COMMITS = 3;
// ---------------------------------------------------------------------------
// CoChangeIndex
// ---------------------------------------------------------------------------
export class CoChangeIndex {
    pairMap = new Map();
    nodeCounts = new Map();
    /**
     * Process one commit. Skips isBulk and isMerge events.
     */
    ingest(event) {
        if (event.isBulk || event.isMerge)
            return;
        const paths = event.files.map((f) => f.path);
        if (paths.length === 0)
            return;
        // Increment per-node commit counts (once per file per event)
        for (const path of paths) {
            this.nodeCounts.set(path, (this.nodeCounts.get(path) ?? 0) + 1);
        }
        // Update pair stats for every unordered pair of files in this commit
        for (let i = 0; i < paths.length; i++) {
            for (let j = i + 1; j < paths.length; j++) {
                this.updatePair(paths[i], paths[j], event.timestamp);
            }
        }
    }
    /**
     * Top co-changed nodes for `node`, sorted by descending confidence.
     */
    topFor(q) {
        const limit = q.limit ?? DEFAULT_LIMIT;
        const minConfidence = q.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
        const now = q.now ?? Math.floor(Date.now() / 1000);
        const halfLifeDays = q.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
        const candidates = this.pairsForNode(q.node)
            .filter((p) => p.sharedCommits >= MIN_SHARED_COMMITS)
            .map((p) => ({ ...p, confidence: computeConfidence(p, now, halfLifeDays) }))
            .filter((p) => p.confidence >= minConfidence);
        candidates.sort((a, b) => b.confidence - a.confidence);
        return candidates.slice(0, limit);
    }
    /**
     * All pairs for `node`, unsorted, no minimum filter.
     */
    allFor(node) {
        return this.pairsForNode(node).map((p) => ({ ...p }));
    }
    /**
     * Serialise to a plain object for JSON persistence.
     * Returns a deep copy — mutations to the returned object do not affect the index.
     */
    snapshot() {
        const pairs = Array.from(this.pairMap.values()).map((p) => ({ ...p }));
        const nodeCounts = {};
        for (const [k, v] of this.nodeCounts) {
            nodeCounts[k] = v;
        }
        return { version: 1, pairs, nodeCounts };
    }
    /**
     * Restore from a snapshot.
     */
    static load(s) {
        const idx = new CoChangeIndex();
        for (const p of s.pairs) {
            const key = pairKey(p.nodeA, p.nodeB);
            idx.pairMap.set(key, { ...p });
        }
        for (const [k, v] of Object.entries(s.nodeCounts)) {
            idx.nodeCounts.set(k, v);
        }
        return idx;
    }
    /**
     * Diagnostic counts.
     */
    size() {
        return { nodes: this.nodeCounts.size, pairs: this.pairMap.size };
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    updatePair(fileA, fileB, timestamp) {
        const [nodeA, nodeB] = fileA <= fileB ? [fileA, fileB] : [fileB, fileA];
        const key = pairKey(nodeA, nodeB);
        const existing = this.pairMap.get(key);
        const sharedCommits = (existing?.sharedCommits ?? 0) + 1;
        const lastSharedTimestamp = Math.max(existing?.lastSharedTimestamp ?? 0, timestamp);
        // Recompute jaccard using current nodeCounts (already incremented for this event)
        const countA = this.nodeCounts.get(nodeA) ?? 1;
        const countB = this.nodeCounts.get(nodeB) ?? 1;
        const union = countA + countB - sharedCommits;
        const jaccard = union > 0 ? sharedCommits / union : 0;
        this.pairMap.set(key, {
            nodeA: nodeA,
            nodeB: nodeB,
            sharedCommits,
            countA,
            countB,
            lastSharedTimestamp,
            jaccard,
        });
    }
    pairsForNode(node) {
        const result = [];
        for (const pair of this.pairMap.values()) {
            if (pair.nodeA === node || pair.nodeB === node) {
                result.push(pair);
            }
        }
        return result;
    }
}
// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
function pairKey(nodeA, nodeB) {
    return `${nodeA}\0${nodeB}`;
}
function computeConfidence(p, now, halfLifeDays) {
    const ageDays = (now - p.lastSharedTimestamp) / 86400;
    return p.jaccard * Math.log1p(p.sharedCommits) * Math.exp(-Math.LN2 * ageDays / halfLifeDays);
}
//# sourceMappingURL=CoChangeIndex.js.map