import { ASTParser } from '../ast/ASTParser.js';
import { CallGraphIndex } from './CallGraphIndex.js';
export interface GraphEdge {
    from: string;
    to: string;
}
export declare class DependencyGraph {
    /** file → set of files it imports (forward edges) */
    private forwardEdges;
    /** file → set of files that import it (reverse edges) */
    private reverseEdges;
    /** Symbol index: symbolName → { filePath, type, signature, startLine?, endLine? } */
    private symbolIndex;
    private callGraphIndex;
    private parser;
    private rootDir;
    private snapshotDir;
    /**
     * Build the graph from all supported files in rootDir using AST parsing.
     */
    buildFromDirectory(rootDir: string): Promise<void>;
    /**
     * Set the ASTParser instance (avoids re-initialization).
     */
    setParser(parser: ASTParser): void;
    /**
     * Get files that the given file directly imports.
     */
    getImports(fileRel: string): string[];
    /**
     * Get files that import the given file.
     */
    getImporters(fileRel: string): string[];
    /**
     * Look up a symbol by name. Returns all definitions across files.
     */
    lookupSymbol(name: string): Array<{
        filePath: string;
        type: string;
        signature: string;
    }>;
    /**
     * Return all symbol names defined in a given file.
     */
    lookupSymbolsByFile(fileRel: string): string[];
    /**
     * Iterate all symbol entries. Used by ctx_find_large_functions.
     */
    symbolEntries(): IterableIterator<[string, Array<{
        filePath: string;
        type: string;
        signature: string;
        startLine?: number;
        endLine?: number;
    }>]>;
    /** Return the pre-built call graph index (TypeScript/TSX only). */
    getCallGraphIndex(): CallGraphIndex;
    /**
     * Traverse the call graph bidirectionally with configurable depth.
     * direction: 'callers' = reverse edges (who imports me)
     *            'callees' = forward edges (who do I import)
     */
    traverse(startFile: string, direction: 'callers' | 'callees', depth?: number): string[];
    /**
     * Add a symbol to the index (primarily used for testing and incremental updates).
     */
    addSymbol(filePath: string, symbol: {
        type: string;
        name: string;
        signature: string;
        startLine?: number;
        endLine?: number;
    }): void;
    /**
     * Add a directed edge: fromFile imports toFile.
     */
    addEdge(fromFile: string, toFile: string): void;
    /**
     * Remove all edges involving a file (used when a file is deleted or re-indexed).
     */
    removeFile(fileRel: string): void;
    /**
     * Incrementally update the graph for a single changed file.
     * Removes stale edges, re-parses imports, and rebuilds the symbol index
     * entries for this file. Saves a new snapshot after the update.
     */
    updateFile(absPath: string, rootDir: string): Promise<void>;
    /**
     * Get total number of edges in the graph.
     */
    edgeCount(): number;
    /**
     * Get all files in the graph.
     */
    allFiles(): string[];
    private getSnapshotPath;
    saveSnapshot(): Promise<void>;
    /** M-2: Validate snapshot shape before hydrating to prevent prototype pollution. */
    private isValidSnapshot;
    private loadSnapshot;
    private resolveImport;
}
//# sourceMappingURL=DependencyGraph.d.ts.map