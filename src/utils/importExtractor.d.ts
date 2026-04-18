export interface RawImport {
    specifier: string;
    isRelative: boolean;
}
/**
 * Extract import specifiers from a source file based on its extension.
 * Returns only imports that are candidates for local-file resolution.
 */
export declare function extractImports(filePath: string, content: string): RawImport[];
/**
 * Resolve a raw import specifier from a given source file to a relative
 * project path. Returns null if the import cannot be resolved to an
 * existing file.
 *
 * @param fromAbs  Absolute path of the file containing the import
 * @param raw      The import specifier (as extracted from source)
 * @param rootDir  Project root directory (needed for Go module resolution)
 */
export declare function resolveImport(fromAbs: string, raw: RawImport, rootDir: string): string | null;
//# sourceMappingURL=importExtractor.d.ts.map