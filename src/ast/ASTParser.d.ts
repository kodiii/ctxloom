export interface MethodRange {
    name: string;
    signatureLine: number;
}
export interface CallSite {
    filePath: string;
    line: number;
    snippet: string;
}
export interface ParsedNode {
    type: 'function' | 'class' | 'interface' | 'import' | 'export_default' | 'arrow_function';
    name: string;
    signature?: string;
    methods?: string[];
    methodRanges?: MethodRange[];
    source?: string;
    startLine: number;
    endLine: number;
}
export declare class ASTParser {
    private tsLang;
    private pyLang;
    private goLang;
    private rustLang;
    private javaLang;
    private csLang;
    private rubyLang;
    private kotlinLang;
    private swiftLang;
    private phpLang;
    private dartLang;
    private grammarLoader;
    init(): Promise<void>;
    /**
     * Load Python grammar on demand. Downloads and caches WASM if needed.
     */
    private loadPython;
    /**
     * Load Go grammar on demand. Downloads and caches WASM if needed.
     */
    private loadGo;
    /**
     * Load Rust grammar on demand. Downloads and caches WASM if needed.
     */
    private loadRust;
    /**
     * Load Java grammar on demand. Downloads and caches WASM if needed.
     */
    private loadJava;
    private loadCSharp;
    private loadRuby;
    private loadKotlin;
    private loadSwift;
    private loadPhp;
    private loadDart;
    parse(filePath: string): Promise<ParsedNode[]>;
    private extractTSNodes;
    private parseVue;
    private parsePython;
    private parseNotebook;
    private extractPythonNodes;
    private parseGo;
    private parseRust;
    private parseJava;
    private parseCSharp;
    private parseRuby;
    private parseKotlin;
    private parseSwift;
    private parsePhp;
    private parseDart;
    /**
     * Find all call sites of a symbol in a file.
     */
    findCallSites(filePath: string, symbolName: string): Promise<CallSite[]>;
    /**
     * Extract all call edges in a TypeScript/TSX file.
     * Tracks the enclosing function/method context for each call site.
     * Used to populate CallGraphIndex during indexing.
     */
    parseAllCallEdges(filePath: string): Promise<Array<{
        callerSymbol: string;
        calleeSymbol: string;
        line: number;
    }>>;
}
//# sourceMappingURL=ASTParser.d.ts.map