/**
 * TsConfigPathsResolver — Resolves TypeScript path alias imports to local file paths.
 *
 * TypeScript projects commonly define path aliases in tsconfig.json, e.g.:
 *   { "paths": { "@/*": ["./*"] } }
 *
 * This resolver:
 *   1. Reads tsconfig.json from the project root (non-fatal if absent)
 *   2. Parses compilerOptions.paths to build a prefix → base-dir mapping
 *   3. Resolves aliased specifiers (e.g. "@/lib/movies") to absolute file paths
 *   4. Falls back to "<rootDir>/<rest>" when no tsconfig.paths entry matches
 *      (covers the Next.js default where "@/*" maps to "./*")
 *
 * Only the first matching candidate that exists on disk is returned.
 */
import fs from 'node:fs';
import path from 'node:path';

interface PathMapping {
  /** The alias prefix with the trailing "*" stripped, e.g. "@/" for "@/*". */
  prefix: string;
  /** Resolved base directories for this alias (absolute paths). */
  baseDirs: string[];
}

const TS_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

export class TsConfigPathsResolver {
  private readonly rootDir: string;
  private mappings: PathMapping[] = [];
  private initialized = false;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * Lazily initialise — reads tsconfig.json on the first call.
   * Safe to call multiple times.
   */
  private init(): void {
    if (this.initialized) return;
    this.initialized = true;

    const tsconfigPath = path.join(this.rootDir, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) return;

    try {
      const raw = fs.readFileSync(tsconfigPath, 'utf-8');

      // Strip single-line comments before parsing — tsconfig allows them
      const stripped = raw.replace(/\/\/[^\n]*/g, '');
      const config = JSON.parse(stripped) as unknown;

      if (
        !config ||
        typeof config !== 'object' ||
        !('compilerOptions' in config) ||
        !config.compilerOptions ||
        typeof config.compilerOptions !== 'object'
      ) {
        return;
      }

      const opts = config.compilerOptions as Record<string, unknown>;
      if (!opts['paths'] || typeof opts['paths'] !== 'object' || Array.isArray(opts['paths'])) {
        return;
      }

      const baseUrl =
        typeof opts['baseUrl'] === 'string'
          ? path.resolve(this.rootDir, opts['baseUrl'])
          : this.rootDir;

      const paths = opts['paths'] as Record<string, unknown>;

      for (const [pattern, rawTargets] of Object.entries(paths)) {
        if (!Array.isArray(rawTargets)) continue;

        // Only handle glob patterns like "@/*" or "~/*"
        if (!pattern.endsWith('/*')) continue;

        const prefix = pattern.slice(0, -1); // strip trailing "*", keep trailing "/"
        const baseDirs: string[] = [];

        for (const target of rawTargets) {
          if (typeof target !== 'string') continue;
          if (!target.endsWith('/*')) continue;

          // Strip the trailing "/*" and resolve relative to baseUrl
          const targetBase = target.slice(0, -2); // strip "/*"
          baseDirs.push(path.resolve(baseUrl, targetBase));
        }

        if (baseDirs.length > 0) {
          this.mappings.push({ prefix, baseDirs });
        }
      }
    } catch {
      // Malformed tsconfig — treat as no aliases
    }
  }

  /**
   * Returns true if the specifier starts with a known alias prefix.
   */
  isAlias(specifier: string): boolean {
    this.init();
    return this.mappings.some(m => specifier.startsWith(m.prefix));
  }

  /**
   * Resolve an aliased specifier to an existing file path (relative to rootDir),
   * or null if no match is found on disk.
   *
   * @param specifier  The raw import string, e.g. "@/lib/movies"
   */
  resolve(specifier: string): string | null {
    this.init();

    // Try each configured mapping
    for (const { prefix, baseDirs } of this.mappings) {
      if (!specifier.startsWith(prefix)) continue;

      const rest = specifier.slice(prefix.length); // e.g. "lib/movies"

      for (const baseDir of baseDirs) {
        const candidate = path.join(baseDir, rest);
        const resolved = this.tryExtensions(candidate);
        if (resolved) return path.relative(this.rootDir, resolved);
      }
    }

    // Fall back: treat "@/" as rootDir when no tsconfig paths matched
    // (Next.js default — "@/*": ["./*"] but tsconfig may be absent)
    if (specifier.startsWith('@/')) {
      const rest = specifier.slice(2); // strip "@/"
      const candidate = path.join(this.rootDir, rest);
      const resolved = this.tryExtensions(candidate);
      if (resolved) return path.relative(this.rootDir, resolved);
    }

    return null;
  }

  private tryExtensions(base: string): string | null {
    // Strip a trailing .js extension that TypeScript source may omit
    const stripped = base.replace(/\.js$/, '');

    for (const ext of TS_EXTENSIONS) {
      const candidate = stripped + ext;
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }
}
