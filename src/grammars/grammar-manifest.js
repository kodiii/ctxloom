export const GRAMMAR_MANIFEST = [
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
    {
        language: 'csharp',
        extensions: ['.cs'],
        npmPackage: '@vscode/tree-sitter-wasm',
        version: '0.3.1',
        wasmFile: 'wasm/tree-sitter-c-sharp.wasm',
        sha256: null,
    },
    {
        language: 'ruby',
        extensions: ['.rb'],
        npmPackage: 'tree-sitter-ruby',
        version: '0.23.1',
        wasmFile: 'tree-sitter-ruby.wasm',
        sha256: null,
    },
    {
        language: 'kotlin',
        extensions: ['.kt', '.kts'],
        npmPackage: 'tree-sitter-kotlin',
        version: '0.3.8',
        wasmFile: 'tree-sitter-kotlin.wasm',
        sha256: null,
    },
    {
        language: 'swift',
        extensions: ['.swift'],
        npmPackage: 'tree-sitter-swift',
        version: '0.7.1',
        wasmFile: 'tree-sitter-swift.wasm',
        sha256: null,
    },
    {
        language: 'php',
        extensions: ['.php'],
        npmPackage: 'tree-sitter-php',
        version: '0.23.11',
        wasmFile: 'tree-sitter-php.wasm',
        sha256: null,
    },
    {
        language: 'dart',
        extensions: ['.dart'],
        npmPackage: 'tree-sitter-dart',
        version: '1.0.0',
        wasmFile: 'tree-sitter-dart.wasm',
        sha256: null,
    },
];
export function findGrammar(language) {
    return GRAMMAR_MANIFEST.find(g => g.language === language);
}
export function findGrammarByExtension(ext) {
    return GRAMMAR_MANIFEST.find(g => g.extensions.includes(ext));
}
//# sourceMappingURL=grammar-manifest.js.map