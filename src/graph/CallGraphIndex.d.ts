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
export type EdgeConfidence = 'extracted' | 'inferred' | 'ambiguous';
export interface CallEdge {
    callerFile: string;
    callerSymbol: string;
    calleeSymbol: string;
    line?: number;
    confidence: EdgeConfidence;
}
export interface CallerEntry {
    file: string;
    symbol: string;
    callerSymbol: string;
    confidence: EdgeConfidence;
}
type SerializedEdge = {
    callerKey: string;
    confidence: EdgeConfidence;
};
type Serialized = {
    bySite: Record<string, SerializedEdge[]>;
};
export declare class CallGraphIndex {
    /** calleeSymbol → Map<"callerFile:callerSymbol", EdgeConfidence> (reverse lookup) */
    private bySite;
    /** "callerFile:callerSymbol" → Set<calleeSymbol> (forward lookup) */
    private byCallerKey;
    addEdge(edge: Omit<CallEdge, 'confidence'> & {
        confidence?: EdgeConfidence;
    }): void;
    /**
     * Returns all symbols called by the given function in the given file.
     */
    getCallees(callerFile: string, callerSymbol: string): string[];
    /**
     * Returns all files that contain the symbol as a caller (i.e., files where
     * this symbol has outgoing call edges). Used to resolve callee definition
     * file when the symbol index has no entry (e.g. in test graphs).
     */
    findFilesForCallerSymbol(symbol: string): string[];
    /**
     * Returns all callers of the given symbol across all indexed files.
     * Optionally filters by confidence tier.
     */
    getCallers(symbol: string, confidenceFilter?: EdgeConfidence): CallerEntry[];
    /**
     * Remove all call edges where callerFile is the given file.
     * Called before re-indexing a file to prevent stale edges.
     */
    removeEdgesForFile(callerFile: string): void;
    /** Total number of distinct caller→callee edges. */
    size(): number;
    toJSON(): Serialized;
    static fromJSON(data: unknown): CallGraphIndex;
}
export {};
//# sourceMappingURL=CallGraphIndex.d.ts.map