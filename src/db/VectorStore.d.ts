export interface VectorSearchResult {
    filePath: string;
    content: string;
    score: number;
}
export declare class VectorStore {
    private dbPath;
    private db;
    private table;
    private initialized;
    constructor(dbPath?: string);
    init(): Promise<void>;
    /**
     * Insert or update a code record.
     */
    upsert(filePath: string, embedding: number[], content: string): Promise<void>;
    /**
     * Search for the top-K most similar code records using vector search.
     */
    search(queryEmbedding: number[], limit?: number): Promise<VectorSearchResult[]>;
    /**
     * Remove a file's embedding from the store.
     */
    remove(filePath: string): Promise<void>;
    /**
     * Get the total number of records.
     */
    count(): Promise<number>;
}
//# sourceMappingURL=VectorStore.d.ts.map