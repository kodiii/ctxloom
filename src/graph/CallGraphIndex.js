/**
 * CallGraphIndex — Pre-built index of actual call-site edges.
 *
 * Maps callee symbol names → set of "callerFile:callerSymbol" keys.
 * Built by parsing call_expression AST nodes in TypeScript/TSX files.
 *
 * Separate from the import graph (DependencyGraph):
 *   Import graph: file-level "which files depend on which"
 *   Call graph:   symbol-level "which functions call which"
 */
export class CallGraphIndex {
    /** calleeSymbol → Map<"callerFile:callerSymbol", EdgeConfidence> (reverse lookup) */
    bySite = new Map();
    /** "callerFile:callerSymbol" → Set<calleeSymbol> (forward lookup) */
    byCallerKey = new Map();
    addEdge(edge) {
        const { callerFile, callerSymbol, calleeSymbol } = edge;
        const confidence = edge.confidence ?? 'extracted';
        // Reverse index: callee → callers with confidence
        if (!this.bySite.has(calleeSymbol)) {
            this.bySite.set(calleeSymbol, new Map());
        }
        this.bySite.get(calleeSymbol).set(`${callerFile}:${callerSymbol}`, confidence);
        // Forward index: caller → callees
        const callerKey = `${callerFile}:${callerSymbol}`;
        if (!this.byCallerKey.has(callerKey)) {
            this.byCallerKey.set(callerKey, new Set());
        }
        this.byCallerKey.get(callerKey).add(calleeSymbol);
    }
    /**
     * Returns all symbols called by the given function in the given file.
     */
    getCallees(callerFile, callerSymbol) {
        const key = `${callerFile}:${callerSymbol}`;
        return Array.from(this.byCallerKey.get(key) ?? []);
    }
    /**
     * Returns all files that contain the symbol as a caller (i.e., files where
     * this symbol has outgoing call edges). Used to resolve callee definition
     * file when the symbol index has no entry (e.g. in test graphs).
     */
    findFilesForCallerSymbol(symbol) {
        const suffix = `:${symbol}`;
        const files = [];
        for (const key of this.byCallerKey.keys()) {
            if (key.endsWith(suffix)) {
                files.push(key.slice(0, key.length - suffix.length));
            }
        }
        return files;
    }
    /**
     * Returns all callers of the given symbol across all indexed files.
     * Optionally filters by confidence tier.
     */
    getCallers(symbol, confidenceFilter) {
        const callerMap = this.bySite.get(symbol);
        if (!callerMap)
            return [];
        const results = [];
        for (const [key, confidence] of callerMap.entries()) {
            if (confidenceFilter !== undefined && confidence !== confidenceFilter) {
                continue;
            }
            const idx = key.indexOf(':');
            const file = idx >= 0 ? key.slice(0, idx) : key;
            const symbol_ = idx >= 0 ? key.slice(idx + 1) : '';
            results.push({ file, symbol: symbol_, callerSymbol: symbol_, confidence });
        }
        return results;
    }
    /**
     * Remove all call edges where callerFile is the given file.
     * Called before re-indexing a file to prevent stale edges.
     */
    removeEdgesForFile(callerFile) {
        const prefix = callerFile + ':';
        // Clean reverse index
        for (const [callee, callerMap] of this.bySite.entries()) {
            for (const key of callerMap.keys()) {
                if (key === callerFile || key.startsWith(prefix)) {
                    callerMap.delete(key);
                }
            }
            if (callerMap.size === 0) {
                this.bySite.delete(callee);
            }
        }
        // Clean forward index
        for (const key of this.byCallerKey.keys()) {
            if (key === callerFile || key.startsWith(prefix)) {
                this.byCallerKey.delete(key);
            }
        }
    }
    /** Total number of distinct caller→callee edges. */
    size() {
        let n = 0;
        for (const m of this.bySite.values())
            n += m.size;
        return n;
    }
    toJSON() {
        return {
            bySite: Object.fromEntries(Array.from(this.bySite.entries()).map(([callee, callerMap]) => [
                callee,
                Array.from(callerMap.entries()).map(([callerKey, confidence]) => ({ callerKey, confidence })),
            ])),
        };
    }
    static fromJSON(data) {
        const idx = new CallGraphIndex();
        if (!data || typeof data !== 'object')
            return idx;
        const { bySite } = data;
        if (!bySite || typeof bySite !== 'object')
            return idx;
        for (const [callee, edges] of Object.entries(bySite)) {
            if (!Array.isArray(edges))
                continue;
            for (const edge of edges) {
                // Support both new format ({ callerKey, confidence }) and
                // legacy format (plain string) for backward compatibility.
                if (typeof edge === 'string') {
                    // Legacy: plain "callerFile:callerSymbol" string, no confidence stored
                    if (!idx.bySite.has(callee)) {
                        idx.bySite.set(callee, new Map());
                    }
                    idx.bySite.get(callee).set(edge, 'extracted');
                    if (!idx.byCallerKey.has(edge)) {
                        idx.byCallerKey.set(edge, new Set());
                    }
                    idx.byCallerKey.get(edge).add(callee);
                }
                else if (edge && typeof edge === 'object' && 'callerKey' in edge) {
                    const { callerKey, confidence } = edge;
                    if (typeof callerKey !== 'string')
                        continue;
                    const resolvedConfidence = confidence === 'inferred' || confidence === 'ambiguous' ? confidence : 'extracted';
                    if (!idx.bySite.has(callee)) {
                        idx.bySite.set(callee, new Map());
                    }
                    idx.bySite.get(callee).set(callerKey, resolvedConfidence);
                    if (!idx.byCallerKey.has(callerKey)) {
                        idx.byCallerKey.set(callerKey, new Set());
                    }
                    idx.byCallerKey.get(callerKey).add(callee);
                }
            }
        }
        return idx;
    }
}
//# sourceMappingURL=CallGraphIndex.js.map