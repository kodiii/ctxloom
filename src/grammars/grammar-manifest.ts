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
  sha256: string | null; // null = unverified (skip hash check in dev)
  downloadUrl?: string; // Override CDN URL (for grammars without WASM in npm package)
}

export const GRAMMAR_MANIFEST: GrammarEntry[] = [
  {
    language: 'python',
    extensions: ['.py'],
    npmPackage: 'tree-sitter-python',
    version: '0.23.6',
    wasmFile: 'tree-sitter-python.wasm',
    sha256: null, // TODO: populate after first download with: shasum -a 256 tree-sitter-python.wasm
  },
  {
    language: 'go',
    extensions: ['.go'],
    npmPackage: 'tree-sitter-go',
    version: '0.23.4',
    wasmFile: 'tree-sitter-go.wasm',
    sha256: null,
  },
  {
    language: 'rust',
    extensions: ['.rs'],
    npmPackage: 'tree-sitter-rust',
    version: '0.23.2',
    wasmFile: 'tree-sitter-rust.wasm',
    sha256: null,
  },
  {
    language: 'java',
    extensions: ['.java'],
    npmPackage: 'tree-sitter-java',
    version: '0.23.5',
    wasmFile: 'tree-sitter-java.wasm',
    sha256: null,
  },
];

export function findGrammar(language: string): GrammarEntry | undefined {
  return GRAMMAR_MANIFEST.find(g => g.language === language);
}

export function findGrammarByExtension(ext: string): GrammarEntry | undefined {
  return GRAMMAR_MANIFEST.find(g => g.extensions.includes(ext));
}
