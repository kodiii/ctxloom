/**
 * GoModuleResolver — Resolves Go module-path imports to local file paths.
 *
 * Go imports use fully-qualified module paths like:
 *   github.com/myorg/myapp/internal/auth
 *
 * To resolve these to local files, we need to:
 *   1. Find go.mod in the project root
 *   2. Parse the `module <path>` declaration
 *   3. Strip the module prefix from the import path → relative subpath
 *   4. Find a .go file inside that subdirectory
 *
 * Also handles relative imports (./subpkg, ../sibling).
 */
import fs from 'node:fs';
import path from 'node:path';

export class GoModuleResolver {
  private readonly rootDir: string;
  private modulePath: string | null = null;
  private initialized = false;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.init();
  }

  private init(): void {
    if (this.initialized) return;
    this.initialized = true;

    const goModPath = path.join(this.rootDir, 'go.mod');
    if (!fs.existsSync(goModPath)) return;

    try {
      const content = fs.readFileSync(goModPath, 'utf-8');
      const match = content.match(/^module\s+(\S+)/m);
      if (match?.[1]) {
        this.modulePath = match[1];
      }
    } catch {
      // go.mod unreadable — leave modulePath as null
    }
  }

  /** Returns the module path declared in go.mod, or null if no go.mod found. */
  getModulePath(): string | null {
    return this.modulePath;
  }

  /**
   * Resolve a module-path import (e.g. `github.com/myorg/myapp/internal/auth`)
   * to the FIRST relative project path (e.g. `internal/auth/auth.go`).
   *
   * Returns null for:
   *   - Third-party imports (different module prefix)
   *   - Relative imports (use resolveRelative() instead)
   *   - Imports where no .go files are found
   *
   * NOTE: A Go import imports a PACKAGE (a directory of .go files), not a
   * single file. Use `resolveAll()` to get every file in the package — that
   * matches Go's compile-unit semantics and is what the graph wants for
   * accurate reachability. `resolve()` is kept for back-compat callers
   * that only need a representative file.
   */
  resolve(importPath: string): string | null {
    const all = this.resolveAll(importPath);
    return all[0] ?? null;
  }

  /**
   * Resolve a module-path import to ALL non-test .go files in the target
   * package directory. This matches Go's compile-unit semantics: a single
   * `import "github.com/foo/bar/pkg"` statement brings the entire `pkg/`
   * directory into the dependency graph — every exported symbol from
   * every .go file in that directory is accessible to the caller.
   *
   * Pre-fix the resolver returned only ONE file per import, which made
   * gin's `binding/` package (~20 files) appear to be a single file from
   * the graph's perspective. The bench's graphReachability on gin
   * collapsed to 0.32 because PRs that touched 4 files in `binding/`
   * had only ONE of them in the graph reach of the entry-point file.
   * Returning ALL package files fixes the structural model.
   *
   * Test files (_test.go) are intentionally excluded — they're not part
   * of a package's public API and aren't imported by callers. The
   * test↔source link is handled separately by per-directory sibling
   * edges (see DependencyGraph's Go intra-package pass).
   */
  resolveAll(importPath: string): string[] {
    if (!this.modulePath) return [];
    if (importPath.startsWith('.')) return []; // use resolveRelativeAll()

    // Must share our module prefix
    if (!importPath.startsWith(this.modulePath)) return [];

    // Strip module prefix to get the subdirectory path
    const suffix = importPath.slice(this.modulePath.length);
    if (!suffix) return []; // import of the root module itself

    // suffix starts with '/' — e.g. '/internal/auth'
    const subPath = suffix.startsWith('/') ? suffix.slice(1) : suffix;
    const absDir = path.join(this.rootDir, subPath);

    return this.allGoFilesInDir(absDir, subPath, /* includeTests */ false);
  }

  /**
   * Resolve a relative import (`./config`, `../pkg`) from a given Go source file.
   * Returns the relative project path to the first .go file found, or null.
   * Kept for back-compat — most callers should prefer `resolveRelativeAll()`.
   */
  resolveRelative(fromFile: string, importSpec: string): string | null {
    const all = this.resolveRelativeAll(fromFile, importSpec);
    return all[0] ?? null;
  }

  /**
   * Resolve a relative import to ALL non-test .go files in the target
   * package directory. See `resolveAll()` for rationale.
   */
  resolveRelativeAll(fromFile: string, importSpec: string): string[] {
    const fromDir = path.dirname(fromFile);
    const absTarget = path.resolve(fromDir, importSpec);
    const subPath = path.relative(this.rootDir, absTarget);
    return this.allGoFilesInDir(absTarget, subPath, /* includeTests */ false);
  }

  /**
   * Enumerate every .go file in a directory, returning project-relative
   * paths sorted with non-test files first. Used by both the single-file
   * and all-files resolvers.
   */
  private allGoFilesInDir(
    absDir: string,
    relDir: string,
    includeTests: boolean,
  ): string[] {
    if (!fs.existsSync(absDir)) return [];

    let entries: string[];
    try {
      entries = fs.readdirSync(absDir);
    } catch {
      return [];
    }

    const goFiles = entries
      .filter(f => f.endsWith('.go'))
      .filter(f => includeTests || !f.endsWith('_test.go'))
      .sort((a, b) => {
        // Non-test files first, then alphabetical
        const aTest = a.endsWith('_test.go') ? 1 : 0;
        const bTest = b.endsWith('_test.go') ? 1 : 0;
        return aTest - bTest || a.localeCompare(b);
      });

    return goFiles.map(f => path.join(relDir, f).replace(/\\/g, '/'));
  }
}
