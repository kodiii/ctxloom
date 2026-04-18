export interface GrammarStatus {
    language: string;
    extensions: string[];
    version: string;
    status: 'cached' | 'missing';
    cachedPath: string | null;
}
export declare class GrammarLoader {
    private readonly cacheDir;
    private readonly cdn;
    private readonly skipVerify;
    constructor(cacheDir?: string);
    /** List all known grammars and their cache status. */
    listGrammars(): GrammarStatus[];
    /** Returns the cached WASM path if it exists, null otherwise. */
    getCachedPath(language: string): string | null;
    isCached(language: string): boolean;
    /**
     * Ensures the grammar WASM is present in the cache.
     * Downloads and verifies if missing. Returns the local path.
     */
    ensureGrammar(language: string): Promise<string>;
    private download;
    private verifyHash;
}
//# sourceMappingURL=GrammarLoader.d.ts.map