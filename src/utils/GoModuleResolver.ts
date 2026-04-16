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
   * to a relative project path (e.g. `internal/auth/auth.go`).
   *
   * Returns null for:
   *   - Third-party imports (different module prefix)
   *   - Relative imports (use resolveRelative() instead)
   *   - Imports where no .go files are found
   */
  resolve(importPath: string): string | null {
    if (!this.modulePath) return null;
    if (importPath.startsWith('.')) return null; // use resolveRelative()

    // Must share our module prefix
    if (!importPath.startsWith(this.modulePath)) return null;

    // Strip module prefix to get the subdirectory path
    const suffix = importPath.slice(this.modulePath.length);
    if (!suffix) return null; // import of the root module itself

    // suffix starts with '/' — e.g. '/internal/auth'
    const subPath = suffix.startsWith('/') ? suffix.slice(1) : suffix;
    const absDir = path.join(this.rootDir, subPath);

    return this.firstGoFileInDir(absDir, subPath);
  }

  /**
   * Resolve a relative import (`./config`, `../pkg`) from a given Go source file.
   * Returns the relative project path to the first .go file found, or null.
   */
  resolveRelative(fromFile: string, importSpec: string): string | null {
    const fromDir = path.dirname(fromFile);
    const absTarget = path.resolve(fromDir, importSpec);
    const subPath = path.relative(this.rootDir, absTarget);
    return this.firstGoFileInDir(absTarget, subPath);
  }

  private firstGoFileInDir(absDir: string, relDir: string): string | null {
    if (!fs.existsSync(absDir)) return null;

    let entries: string[];
    try {
      entries = fs.readdirSync(absDir);
    } catch {
      return null;
    }

    const goFiles = entries
      .filter(f => f.endsWith('.go'))
      .sort((a, b) => {
        // Prefer non-test files first
        const aTest = a.endsWith('_test.go') ? 1 : 0;
        const bTest = b.endsWith('_test.go') ? 1 : 0;
        return aTest - bTest || a.localeCompare(b);
      });

    if (goFiles.length === 0) return null;

    return path.join(relDir, goFiles[0]).replace(/\\/g, '/');
  }
}
