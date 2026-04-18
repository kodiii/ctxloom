/**
 * Grammar manifest — known tree-sitter WASM grammars.
 *
 * SHA-256 hashes must be verified before adding a new entry.
 * Run: curl -sL <url> | shasum -a 256
 *
 * CDN default: https://cdn.jsdelivr.net/npm/{package}@{version}/{file}
 */
export interface GrammarEntry {
    language: string;
    extensions: string[];
    npmPackage: string;
    version: string;
    wasmFile: string;
    sha256: string | null;
    downloadUrl?: string;
}
export declare const GRAMMAR_MANIFEST: GrammarEntry[];
export declare function findGrammar(language: string): GrammarEntry | undefined;
export declare function findGrammarByExtension(ext: string): GrammarEntry | undefined;
//# sourceMappingURL=grammar-manifest.d.ts.map