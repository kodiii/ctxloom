export declare class GoModuleResolver {
    private readonly rootDir;
    private modulePath;
    private initialized;
    constructor(rootDir: string);
    private init;
    /** Returns the module path declared in go.mod, or null if no go.mod found. */
    getModulePath(): string | null;
    /**
     * Resolve a module-path import (e.g. `github.com/myorg/myapp/internal/auth`)
     * to a relative project path (e.g. `internal/auth/auth.go`).
     *
     * Returns null for:
     *   - Third-party imports (different module prefix)
     *   - Relative imports (use resolveRelative() instead)
     *   - Imports where no .go files are found
     */
    resolve(importPath: string): string | null;
    /**
     * Resolve a relative import (`./config`, `../pkg`) from a given Go source file.
     * Returns the relative project path to the first .go file found, or null.
     */
    resolveRelative(fromFile: string, importSpec: string): string | null;
    private firstGoFileInDir;
}
//# sourceMappingURL=GoModuleResolver.d.ts.map