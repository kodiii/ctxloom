declare const EMBEDDING_DIMENSION = 384;
/**
 * Generate a 384-dimensional embedding for the given text.
 */
export declare function generateEmbedding(text: string): Promise<number[]>;
/**
 * Collect all supported source files from a directory.
 * Respects common ignore patterns.
 */
export declare function collectFiles(dir: string, results?: string[]): string[];
/**
 * Index an entire directory: chunk files and store embeddings.
 * Processes up to CONCURRENCY files simultaneously for better throughput.
 */
export declare function indexDirectory(rootDir: string, onProgress?: (file: string, index: number, total: number) => void): Promise<{
    indexed: number;
    errors: number;
}>;
export { EMBEDDING_DIMENSION };
//# sourceMappingURL=embedder.d.ts.map