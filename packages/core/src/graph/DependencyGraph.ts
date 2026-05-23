/**
 * In-Memory DependencyGraph — Bidirectional import graph.
 *
 * Uses an adjacency list (Map<string, Set<string>>) for both forward
 * (imports) and reverse (importers) edges. Supports sub-millisecond
 * lookups without disk access.
 *
 * Includes SnapshotManager for persistence: serializes to JSON on disk,
 * hydrates on startup in O(n) time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ASTParser } from '../ast/ASTParser.js';
import { collectFiles } from '../indexer/embedder.js';
import { logger } from '../utils/logger.js';
import {
  extractImports,
  resolveImport as resolveMultiLangImport,
} from '../utils/importExtractor.js';
import { GoModuleResolver } from '../utils/GoModuleResolver.js';
import { TsConfigPathsResolver } from '../utils/TsConfigPathsResolver.js';
import { CallGraphIndex } from './CallGraphIndex.js';

/** Extensions handled by the TypeScript/JS AST parser. */
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue']);
/** Extensions whose call graph is extracted by the Python walker. */
const PY_EXTENSIONS = new Set(['.py', '.ipynb']);
/** Extensions handled by the AST parser (all 13 supported languages). */
const AST_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.java', '.cs', '.rb', '.kt', '.kts', '.swift', '.ipynb', '.php', '.dart']);

// Build-time version constant injected by the root tsup config
// (see tsup.config.ts: `define: { __CTXLOOM_VERSION__: ... }`).
// Mirrors the pattern in packages/core/src/license/telemetry.ts so the
// bundled CLI gets the real version stamped in and unbuilt `tsx` runs
// fall back to 'dev'. Used by the graph snapshot writer so we can detect
// "snapshot from older ctxloom" on subsequent loads and force a rebuild —
// otherwise a snapshot written by a binary that pre-dated (say) absolute
// Python import resolution silently re-hydrates with empty edges after
// the user upgrades. See SNAPSHOT_SCHEMA_VERSION bump notes below.
declare const __CTXLOOM_VERSION__: string | undefined;
const CTXLOOM_VERSION: string =
  typeof __CTXLOOM_VERSION__ === 'string' && __CTXLOOM_VERSION__.length > 0
    ? __CTXLOOM_VERSION__
    : 'dev';

/**
 * Graph snapshot schema version.
 *
 *   1 → 2: added `ctxloomVersion` field so the loader can invalidate
 *          snapshots written by an older binary. Snapshots without this
 *          field are treated as legacy and unconditionally rebuilt.
 */
const SNAPSHOT_SCHEMA_VERSION = 2;

/**
 * Compare two ctxloom version strings ("1.7.1", "1.6.0", "dev").
 *
 * Returns `'older'` when `snapshotVer` is strictly less than `currentVer`,
 * `'newer'` when strictly greater, `'same'` when equal, and `'unknown'`
 * when the two sides can't be meaningfully ordered.
 *
 * 'dev' handling (the constant a `tsx`-driven unbuilt run gets):
 *
 *   - Both 'dev'  → 'same'    — keep dev loops fast; no signal to invalidate on.
 *   - Current 'dev', snapshot real → 'older' — a dev binary may have a
 *                                              schema/resolver change a
 *                                              prior release didn't know
 *                                              about, so invalidate to be safe.
 *   - Snapshot 'dev', current real → 'unknown' — the snapshot was written by
 *                                                an unknown binary; safest to
 *                                                trust it (don't trigger a
 *                                                rebuild storm for users who
 *                                                briefly ran a local dev build).
 *
 * Intentionally inline (no `semver` dep): the writer only emits
 * MAJOR.MINOR.PATCH strings straight from package.json, so a 12-line
 * splitter is both sufficient and dependency-free.
 */
function compareCtxloomVersions(
  snapshotVer: string,
  currentVer: string,
): 'older' | 'newer' | 'same' | 'unknown' {
  if (snapshotVer === currentVer) return 'same';
  // Snapshot from an unknown dev binary — don't second-guess it.
  if (snapshotVer === 'dev') return 'unknown';
  // Current is dev, snapshot is a real release → treat snapshot as older.
  // Rationale: a dev binary almost always represents "next version under
  // development", so any prior release's snapshot is by definition older.
  if (currentVer === 'dev') return 'older';
  const parse = (v: string): [number, number, number] | null => {
    const parts = v.split('.').map((s) => Number.parseInt(s, 10));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const a = parse(snapshotVer);
  const b = parse(currentVer);
  if (!a || !b) return 'unknown';
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return 'older';
    if (a[i] > b[i]) return 'newer';
  }
  return 'same';
}

export interface GraphEdge {
  from: string;
  to: string;
}

export class DependencyGraph {
  /** file → set of files it imports (forward edges) */
  private forwardEdges = new Map<string, Set<string>>();
  /** file → set of files that import it (reverse edges) */
  private reverseEdges = new Map<string, Set<string>>();

  /** Symbol index: symbolName → { filePath, type, signature, startLine?, endLine? } */
  private symbolIndex = new Map<string, Array<{
    filePath: string;
    type: string;
    signature: string;
    startLine?: number;
    endLine?: number;
  }>>();

  private callGraphIndex = new CallGraphIndex();

  /**
   * Re-export tracing (v1.6.x):
   *   reExportMap[barrelFile][symbol] = sourceFile
   *
   * Built during graph construction from `from .submodule import Name`
   * statements (Python). When file C imports `from <barrel> import Name`,
   * the import resolver consults this map and emits a parallel edge
   * C → sourceFile so blast-radius queries against sourceFile can find
   * C as a transitive consumer through the barrel.
   *
   * Concrete fastapi case:
   *   tests/test_routing.py has `from fastapi import APIRouter`
   *   fastapi/__init__.py has `from .routing import APIRouter`
   *   → reExportMap['fastapi/__init__.py']['APIRouter'] = 'fastapi/routing.py'
   *   → emit edge tests/test_routing.py → fastapi/routing.py
   */
  private reExportMap = new Map<string, Map<string, string>>();

  /**
   * Pending re-export queries. Populated during pass 1 (parse all
   * files, extract their imports); resolved in pass 2 once the
   * reExportMap is fully built. Required because file ordering would
   * otherwise miss re-exports whose source files are parsed AFTER the
   * consumer file.
   */
  private pendingReExportQueries: Array<{
    caller: string;
    barrel: string;
    symbols: readonly string[];
  }> = [];

  private parser: ASTParser | null = null;
  private rootDir: string = '';
  private snapshotDir: string = '';
  private tsPathsResolver: TsConfigPathsResolver | null = null;

  /**
   * Build the graph from all supported files in rootDir using AST parsing.
   */
  async buildFromDirectory(
    rootDir: string,
    options?: { afterReady?: () => Promise<void> },
  ): Promise<void> {
    this.rootDir = rootDir;
    this.snapshotDir = path.join(rootDir, '.ctxloom');
    this.tsPathsResolver = new TsConfigPathsResolver(rootDir);

    // Collect files first so we can pass the count to the snapshot staleness check
    const files = collectFiles(rootDir);

    // Try to hydrate from snapshot, passing current file count for staleness detection
    if (await this.loadSnapshot(files.length)) {
      logger.info('Loaded graph from snapshot', { edges: this.edgeCount() });
      if (options?.afterReady) {
        try { await options.afterReady(); }
        catch (err) { logger.warn('afterReady callback threw', { detail: String(err) }); }
      }
      return;
    }

    // No usable snapshot — build from scratch
    if (!this.parser) {
      this.parser = new ASTParser();
      await this.parser.init();
    }

    for (const absPath of files) {
      const relPath = path.relative(rootDir, absPath);
      const ext = path.extname(absPath).toLowerCase();

      try {
        // Register file so allFiles() includes it even with no imports
        if (!this.forwardEdges.has(relPath)) {
          this.forwardEdges.set(relPath, new Set());
        }

        if (AST_EXTENSIONS.has(ext)) {
          // ── AST-parsed languages: symbol indexing via tree-sitter ────────
          const nodes = await this.parser.parse(absPath);

          if (TS_EXTENSIONS.has(ext)) {
            // TypeScript/JS: AST import nodes → TS-style path resolution
            const importNodes = nodes.filter(n => n.type === 'import');
            for (const imp of importNodes) {
              const src = imp.source ?? '';
              if (src.startsWith('.')) {
                // Relative import — resolve against the importing file's directory
                const resolved = this.resolveImport(absPath, src, rootDir);
                if (resolved) this.addEdge(relPath, resolved);
              } else if (this.tsPathsResolver?.isAlias(src)) {
                // Path alias (e.g. "@/lib/movies") — resolve via tsconfig paths
                const resolved = this.tsPathsResolver.resolve(src);
                if (resolved) this.addEdge(relPath, resolved);
              }
              // Otherwise it is a bare node_modules specifier — skip
            }
          } else if (ext === '.go') {
            // Go: use AST import nodes + GoModuleResolver for module-path
            // imports. CRITICAL: a Go import targets a PACKAGE (an entire
            // directory of .go files), not a single file. Fan out to all
            // production files in the target package so the graph reflects
            // Go's compile-unit semantics — otherwise importing
            // `github.com/foo/bar/pkg` only attaches to ONE of pkg/'s
            // ~20 files and a PR that touches sibling files looks
            // unreachable. Pre-fix this collapsed gin's graphReachability
            // to 0.32 in the bench (PRs touched 4 files in binding/, only
            // 1 was reachable from the entry point).
            const goResolver = new GoModuleResolver(rootDir);
            const importNodes = nodes.filter(n => n.type === 'import');
            for (const imp of importNodes) {
              const spec = imp.source ?? imp.name;
              const isRelative = spec.startsWith('.');
              const resolvedAll = isRelative
                ? goResolver.resolveRelativeAll(absPath, spec)
                : goResolver.resolveAll(spec);
              for (const resolved of resolvedAll) {
                this.addEdge(relPath, resolved);
              }
            }
          } else {
            // Python / Rust / Java: use AST import nodes (more accurate than regex)
            // Fall back to regex extractor if AST produced no imports
            const importNodes = nodes.filter(n => n.type === 'import');
            if (importNodes.length > 0) {
              for (const imp of importNodes) {
                const specifier = imp.source ?? imp.name;
                const isRelative = specifier.startsWith('.');
                const resolved = resolveMultiLangImport(absPath, { specifier, isRelative }, rootDir);
                if (resolved) {
                  this.addEdge(relPath, resolved);

                  // Re-export bookkeeping for Python (v1.6.x). Two cases:
                  //
                  // 1. RELATIVE import with named symbols → THIS file
                  //    re-exports those names from the resolved sibling.
                  //    Record in reExportMap so downstream consumers
                  //    can trace through.
                  //
                  // 2. ANY import with named symbols → defer a query
                  //    against the (eventually-built) reExportMap.
                  //    Resolved in pass 2 after all files are parsed.
                  if (ext === '.py' && imp.importedNames && imp.importedNames.length > 0) {
                    if (isRelative) {
                      let map = this.reExportMap.get(relPath);
                      if (!map) {
                        map = new Map();
                        this.reExportMap.set(relPath, map);
                      }
                      for (const name of imp.importedNames) {
                        map.set(name, resolved);
                      }
                    }
                    this.pendingReExportQueries.push({
                      caller: relPath,
                      barrel: resolved,
                      symbols: imp.importedNames,
                    });
                  }
                }
              }
            } else {
              // AST grammar unavailable — fall back to regex
              const content = fs.readFileSync(absPath, 'utf-8');
              const rawImports = extractImports(absPath, content);
              for (const raw of rawImports) {
                const resolved = resolveMultiLangImport(absPath, raw, rootDir);
                if (resolved) this.addEdge(relPath, resolved);
              }
            }
          }

          // Symbol indexing for all AST-parsed languages
          for (const node of nodes) {
            if (node.type === 'function' || node.type === 'class' || node.type === 'interface' || node.type === 'method') {
              const existing = this.symbolIndex.get(node.name) ?? [];
              existing.push({
                filePath: relPath,
                type: node.type,
                signature: node.signature ?? `${node.type} ${node.name}`,
                startLine: node.startLine,
                endLine: node.endLine,
              });
              this.symbolIndex.set(node.name, existing);
            }
          }

          // Call graph edges: TypeScript/JS + Python (v1.6.1).
          // Each language has its own walker because tree-sitter node
          // type names differ ('call_expression' for TS vs 'call' for
          // Python). Other languages don't yet have a call-graph walker;
          // tracked under task #2 (v1.7.0 host adapters).
          if (TS_EXTENSIONS.has(ext)) {
            const callEdges = await this.parser.parseAllCallEdges(absPath);
            for (const edge of callEdges) {
              this.callGraphIndex.addEdge({ callerFile: relPath, ...edge });
            }
          } else if (PY_EXTENSIONS.has(ext)) {
            const callEdges = await this.parser.parseAllPythonCallEdges(absPath);
            for (const edge of callEdges) {
              this.callGraphIndex.addEdge({ callerFile: relPath, ...edge });
            }
          }
        } else {
          // ── Other languages (.c, .cpp, .h, .md, etc.): regex-based ──────
          const content = fs.readFileSync(absPath, 'utf-8');
          const rawImports = extractImports(absPath, content);
          for (const raw of rawImports) {
            const resolved = resolveMultiLangImport(absPath, raw, rootDir);
            if (resolved) this.addEdge(relPath, resolved);
          }
        }
      } catch (err) {
        logger.error('Failed to parse', { file: relPath, detail: err instanceof Error ? err.message : String(err) });
      }
    }

    // Pass 2: re-export tracing. Resolve deferred queries against the
    // now-complete reExportMap. For each `from <barrel> import Sym` we
    // saw during pass 1, look up the barrel's re-export of Sym and add
    // a parallel edge consumer → real_definition_file. See
    // reExportMap field for the fastapi example.
    let reExportEdgesAdded = 0;
    for (const { caller, barrel, symbols } of this.pendingReExportQueries) {
      const map = this.reExportMap.get(barrel);
      if (!map) continue;
      for (const sym of symbols) {
        const source = map.get(sym);
        if (source && source !== caller && source !== barrel) {
          // addEdge is idempotent (Set-backed) so duplicates are free.
          this.addEdge(caller, source);
          reExportEdgesAdded += 1;
        }
      }
    }
    // Free the buffer — pendingReExportQueries can be large.
    this.pendingReExportQueries = [];
    if (reExportEdgesAdded > 0) {
      logger.info('Re-export tracing added parallel edges', { count: reExportEdgesAdded });
    }

    // Pass 3: Go test↔source linkage. In Go, `foo_test.go` is part of
    // the same package as `foo.go` (same compile unit, full access to
    // package-private symbols). But test files import the package via
    // its module path, not the source file directly, so there's no
    // syntactic import edge connecting them. Without an explicit link,
    // a PR that touches `binding/binding.go` AND `binding/binding_test.go`
    // shows the test file as unreachable from any entry point — the
    // graph misses the structural relationship Go's compiler treats as
    // primary.
    //
    // Heuristic: for every `<name>_test.go`, link it bidirectionally to
    // `<name>.go` in the same directory if it exists. Falls back to
    // linking to any sibling .go file in the same package directory if
    // the namesake source doesn't exist. This is over-inflation in the
    // tail case but accurate to Go's "tests share package scope" model
    // and was the missing link behind gin's bench graphReachability=0.32.
    let goTestEdgesAdded = 0;
    for (const relPath of this.forwardEdges.keys()) {
      if (!relPath.endsWith('_test.go')) continue;
      const dir = path.dirname(relPath);
      const base = path.basename(relPath, '_test.go');
      const namesake = path.join(dir, base + '.go').replace(/\\/g, '/');
      if (this.forwardEdges.has(namesake)) {
        // Bidirectional: test→source for "test depends on source",
        // source→test isn't strictly true semantically but is needed
        // for BFS reachability from the source side too. addEdge is
        // idempotent so duplicates from a prior pass are free.
        this.addEdge(relPath, namesake);
        this.addEdge(namesake, relPath);
        goTestEdgesAdded += 2;
        continue;
      }
      // Fallback: connect to any non-test sibling .go file in the same
      // directory (package-level coupling). Bounded by reading the dir
      // once per test file — O(N) over the corpus.
      const absDir = path.join(this.rootDir, dir);
      try {
        const siblings = fs
          .readdirSync(absDir)
          .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
        for (const sib of siblings) {
          const sibRel = path.join(dir, sib).replace(/\\/g, '/');
          this.addEdge(relPath, sibRel);
          this.addEdge(sibRel, relPath);
          goTestEdgesAdded += 2;
        }
      } catch {
        // dir disappeared between index passes — ignore
      }
    }
    if (goTestEdgesAdded > 0) {
      logger.info('Go test↔source linkage added edges', { count: goTestEdgesAdded });
    }

    // Save snapshot
    await this.saveSnapshot();
    logger.info('Graph built', { files: files.length, edges: this.edgeCount() });
    if (options?.afterReady) {
      try { await options.afterReady(); }
      catch (err) { logger.warn('afterReady callback threw', { detail: String(err) }); }
    }
  }

  /**
   * Set the ASTParser instance (avoids re-initialization).
   */
  setParser(parser: ASTParser): void {
    this.parser = parser;
  }

  /**
   * Snapshot-only hydration: sets up paths and tries to load from the
   * persisted snapshot without triggering a full AST rebuild.
   *
   * Returns true when the snapshot was found and loaded, false when no
   * snapshot exists (caller should tell the user to run `ctxloom index`).
   */
  async loadSnapshotOnly(rootDir: string): Promise<boolean> {
    this.rootDir = rootDir;
    this.snapshotDir = path.join(rootDir, '.ctxloom');
    return this.loadSnapshot();
  }

  /**
   * Get files that the given file directly imports.
   */
  getImports(fileRel: string): string[] {
    return Array.from(this.forwardEdges.get(fileRel) ?? []);
  }

  /**
   * Get files that import the given file.
   */
  getImporters(fileRel: string): string[] {
    return Array.from(this.reverseEdges.get(fileRel) ?? []);
  }

  /**
   * Look up a symbol by name. Returns all definitions across files.
   */
  lookupSymbol(name: string): Array<{ filePath: string; type: string; signature: string }> {
    return this.symbolIndex.get(name) ?? [];
  }

  /**
   * Return all symbol names defined in a given file.
   */
  lookupSymbolsByFile(fileRel: string): string[] {
    const results: string[] = [];
    for (const [name, entries] of this.symbolIndex.entries()) {
      if (entries.some(e => e.filePath === fileRel)) {
        results.push(name);
      }
    }
    return results;
  }

  /**
   * Iterate all symbol entries. Used by ctx_find_large_functions.
   */
  symbolEntries(): IterableIterator<[string, Array<{ filePath: string; type: string; signature: string; startLine?: number; endLine?: number }>]> {
    return this.symbolIndex.entries();
  }

  /** Return the pre-built call graph index (TypeScript/TSX only). */
  getCallGraphIndex(): CallGraphIndex {
    return this.callGraphIndex;
  }

  /**
   * Traverse the call graph bidirectionally with configurable depth.
   * direction: 'callers' = reverse edges (who imports me)
   *            'callees' = forward edges (who do I import)
   */
  traverse(startFile: string, direction: 'callers' | 'callees', depth: number = 1): string[] {
    // M-4: Clamp depth to prevent runaway traversal on cyclic graphs
    const MAX_DEPTH = 10;
    depth = Math.min(depth, MAX_DEPTH);

    const visited = new Set<string>();
    const queue: Array<{ file: string; currentDepth: number }> = [{ file: startFile, currentDepth: 0 }];

    while (queue.length > 0) {
      const { file, currentDepth } = queue.shift()!;
      if (visited.has(file)) continue;
      visited.add(file);

      if (currentDepth < depth) {
        const edges = direction === 'callers'
          ? this.getImporters(file)
          : this.getImports(file);

        for (const next of edges) {
          if (!visited.has(next)) {
            queue.push({ file: next, currentDepth: currentDepth + 1 });
          }
        }
      }
    }

    visited.delete(startFile); // Don't include the start file itself
    return Array.from(visited);
  }

  /**
   * Add a symbol to the index (primarily used for testing and incremental updates).
   */
  addSymbol(
    filePath: string,
    symbol: { type: string; name: string; signature: string; startLine?: number; endLine?: number },
  ): void {
    const existing = this.symbolIndex.get(symbol.name) ?? [];
    existing.push({
      filePath,
      type: symbol.type,
      signature: symbol.signature,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    });
    this.symbolIndex.set(symbol.name, existing);
    // Ensure file is registered in forward edges so allFiles() includes it
    if (!this.forwardEdges.has(filePath)) {
      this.forwardEdges.set(filePath, new Set());
    }
  }

  /**
   * Add a directed edge: fromFile imports toFile.
   */
  addEdge(fromFile: string, toFile: string): void {
    if (!this.forwardEdges.has(fromFile)) {
      this.forwardEdges.set(fromFile, new Set());
    }
    this.forwardEdges.get(fromFile)!.add(toFile);

    if (!this.reverseEdges.has(toFile)) {
      this.reverseEdges.set(toFile, new Set());
    }
    this.reverseEdges.get(toFile)!.add(fromFile);
  }

  /**
   * Remove all edges involving a file (used when a file is deleted or re-indexed).
   */
  removeFile(fileRel: string): void {
    // Remove forward edges
    const imports = this.forwardEdges.get(fileRel);
    if (imports) {
      for (const imp of imports) {
        this.reverseEdges.get(imp)?.delete(fileRel);
      }
      this.forwardEdges.delete(fileRel);
    }

    // Remove reverse edges
    const importers = this.reverseEdges.get(fileRel);
    if (importers) {
      for (const imp of importers) {
        this.forwardEdges.get(imp)?.delete(fileRel);
      }
      this.reverseEdges.delete(fileRel);
    }
  }

  /**
   * Incrementally update the graph for a single changed file.
   * Removes stale edges, re-parses imports, and rebuilds the symbol index
   * entries for this file. Saves a new snapshot after the update.
   */
  async updateFile(absPath: string, rootDir: string): Promise<void> {
    if (!this.parser) {
      logger.warn('DependencyGraph.updateFile: no parser set, skipping graph update');
      return;
    }

    // Ensure tsPathsResolver is ready when updateFile is called without a prior buildFromDirectory
    if (!this.tsPathsResolver || this.rootDir !== rootDir) {
      this.tsPathsResolver = new TsConfigPathsResolver(rootDir);
    }

    const relPath = path.relative(rootDir, absPath);

    // 1. Remove stale edges and symbol index entries for this file
    this.removeFile(relPath);
    // Re-register so allFiles() retains files with zero imports after update
    if (!this.forwardEdges.has(relPath)) {
      this.forwardEdges.set(relPath, new Set());
    }
    // Remove stale call graph edges for this file before re-indexing
    this.callGraphIndex.removeEdgesForFile(relPath);
    for (const [symbol, entries] of this.symbolIndex.entries()) {
      const filtered = entries.filter(e => e.filePath !== relPath);
      if (filtered.length === 0) {
        this.symbolIndex.delete(symbol);
      } else {
        this.symbolIndex.set(symbol, filtered);
      }
    }

    // 2. Re-parse and rebuild edges
    const ext = path.extname(absPath).toLowerCase();
    try {
      if (AST_EXTENSIONS.has(ext)) {
        // TypeScript / JavaScript / Python / Go / Rust / Java: full AST parse
        const nodes = await this.parser.parse(absPath);

        if (TS_EXTENSIONS.has(ext)) {
          const importNodes = nodes.filter(n => n.type === 'import');
          for (const importNode of importNodes) {
            const src = importNode.source ?? '';
            if (src.startsWith('.')) {
              // Relative import
              const resolved = this.resolveImport(absPath, src, rootDir);
              if (resolved) this.addEdge(relPath, resolved);
            } else if (this.tsPathsResolver?.isAlias(src)) {
              // Path alias (e.g. "@/lib/movies") — resolve via tsconfig paths
              const resolved = this.tsPathsResolver.resolve(src);
              if (resolved) this.addEdge(relPath, resolved);
            }
          }
        } else if (ext === '.go') {
          // Fan out Go package imports to ALL non-test files in the
          // target package. See the primary parse path for the full
          // rationale. Mirrored here so incremental re-indexing produces
          // the same edge set as a clean rebuild.
          const goResolver = new GoModuleResolver(rootDir);
          const importNodes = nodes.filter(n => n.type === 'import');
          for (const imp of importNodes) {
            const spec = imp.source ?? imp.name;
            const isRelative = spec.startsWith('.');
            const resolvedAll = isRelative
              ? goResolver.resolveRelativeAll(absPath, spec)
              : goResolver.resolveAll(spec);
            for (const resolved of resolvedAll) {
              this.addEdge(relPath, resolved);
            }
          }
        } else {
          // Python / Rust / Java: prefer AST import nodes, fall back to regex
          const importNodes = nodes.filter(n => n.type === 'import');
          if (importNodes.length > 0) {
            for (const imp of importNodes) {
              const specifier = imp.source ?? imp.name;
              const isRelative = specifier.startsWith('.');
              const resolved = resolveMultiLangImport(absPath, { specifier, isRelative }, rootDir);
              if (resolved) this.addEdge(relPath, resolved);
            }
          } else {
            const content = fs.readFileSync(absPath, 'utf-8');
            const rawImports = extractImports(absPath, content);
            for (const raw of rawImports) {
              const resolved = resolveMultiLangImport(absPath, raw, rootDir);
              if (resolved) this.addEdge(relPath, resolved);
            }
          }
        }

        // 3. Rebuild symbol index entries from this file
        for (const node of nodes) {
          if (node.type === 'function' || node.type === 'class' || node.type === 'interface' || node.type === 'method') {
            const existing = this.symbolIndex.get(node.name) ?? [];
            existing.push({
              filePath: relPath,
              type: node.type,
              signature: node.signature ?? `${node.type} ${node.name}`,
              startLine: node.startLine,
              endLine: node.endLine,
            });
            this.symbolIndex.set(node.name, existing);
          }
        }

        // Rebuild call graph edges: TypeScript/JS + Python (v1.6.1).
        // Stale edges were cleared above via removeEdgesForFile().
        if (TS_EXTENSIONS.has(ext)) {
          const callEdges = await this.parser.parseAllCallEdges(absPath);
          for (const edge of callEdges) {
            this.callGraphIndex.addEdge({ callerFile: relPath, ...edge });
          }
        } else if (PY_EXTENSIONS.has(ext)) {
          const callEdges = await this.parser.parseAllPythonCallEdges(absPath);
          for (const edge of callEdges) {
            this.callGraphIndex.addEdge({ callerFile: relPath, ...edge });
          }
        }
      } else {
        // Other languages: regex-based extraction
        const content = fs.readFileSync(absPath, 'utf-8');
        const rawImports = extractImports(absPath, content);
        for (const raw of rawImports) {
          const resolved = resolveMultiLangImport(absPath, raw, rootDir);
          if (resolved) this.addEdge(relPath, resolved);
        }
      }

      logger.info('Graph updated', { file: relPath, edges: this.edgeCount() });
    } catch (err) {
      logger.error('Failed to update graph', { file: relPath, detail: err instanceof Error ? err.message : String(err) });
    }

    // 4. Persist updated snapshot
    this.saveSnapshot();
  }

  /**
   * Get total number of edges in the graph.
   */
  edgeCount(): number {
    let count = 0;
    for (const edges of this.forwardEdges.values()) {
      count += edges.size;
    }
    return count;
  }

  /**
   * Get all files in the graph.
   */
  allFiles(): string[] {
    const files = new Set<string>();
    for (const [file] of this.forwardEdges) files.add(file);
    for (const [file] of this.reverseEdges) files.add(file);
    return Array.from(files);
  }

  // ─── Snapshot persistence ──────────────────────────────────────────────

  private getSnapshotPath(): string {
    return path.join(this.snapshotDir, 'graph-snapshot.json');
  }

  async saveSnapshot(): Promise<void> {
    if (!this.snapshotDir) return;

    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }

    const data = {
      version: SNAPSHOT_SCHEMA_VERSION,
      // Build-time ctxloom version. The loader uses this to invalidate
      // snapshots written by an older binary (e.g. one that pre-dated
      // absolute Python import resolution) so users don't get stuck with
      // an empty graph after `npm i -g ctxloom-pro@latest`.
      ctxloomVersion: CTXLOOM_VERSION,
      builtAt: Date.now(),
      fileCount: this.forwardEdges.size,
      forwardEdges: Object.fromEntries(
        Array.from(this.forwardEdges.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      reverseEdges: Object.fromEntries(
        Array.from(this.reverseEdges.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      symbolIndex: Object.fromEntries(this.symbolIndex.entries()),
    };

    // L-3: Atomic write via temp file + rename to prevent partial reads.
    // Per-PID suffix avoids ENOENT races when multiple ctxloom MCP
    // servers run against the same repo (e.g. multiple Claude Code
    // windows on the same project). rename(2) is atomic so last-writer-
    // wins on the final file is the desired semantic for a cache.
    const snapshotPath = this.getSnapshotPath();
    const tmpPath = `${snapshotPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, snapshotPath);

    // Save call graph snapshot alongside import graph snapshot
    const callData = this.callGraphIndex.toJSON();
    const callPath = path.join(this.snapshotDir, 'call-graph-snapshot.json');
    const callTmp = `${callPath}.${process.pid}.tmp`;
    fs.writeFileSync(callTmp, JSON.stringify(callData));
    fs.renameSync(callTmp, callPath);
  }

  /** M-2: Validate snapshot shape before hydrating to prevent prototype pollution. */
  private isValidSnapshot(data: unknown): data is {
    version: number;
    /** Present in schema v2+; absent in legacy v1 snapshots (treated as 'unknown'). */
    ctxloomVersion?: string;
    forwardEdges: Record<string, string[]>;
    reverseEdges: Record<string, string[]>;
    fileCount?: number;
    symbolIndex?: Record<string, Array<{ filePath: string; type: string; signature: string }>>;
  } {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    if (typeof d['version'] !== 'number') return false;
    // ctxloomVersion is optional for forward-compat with legacy v1 snapshots.
    // Loader handles the "missing → invalidate" case explicitly.
    if (d['ctxloomVersion'] !== undefined && typeof d['ctxloomVersion'] !== 'string') return false;
    if (!d['forwardEdges'] || typeof d['forwardEdges'] !== 'object') return false;
    if (!d['reverseEdges'] || typeof d['reverseEdges'] !== 'object') return false;
    // Validate that edge values are arrays of strings
    for (const v of Object.values(d['forwardEdges'] as Record<string, unknown>)) {
      if (!Array.isArray(v) || !v.every(s => typeof s === 'string')) return false;
    }
    for (const v of Object.values(d['reverseEdges'] as Record<string, unknown>)) {
      if (!Array.isArray(v) || !v.every(s => typeof s === 'string')) return false;
    }
    return true;
  }

  private async loadSnapshot(currentFileCount?: number): Promise<boolean> {
    const snapshotPath = this.getSnapshotPath();
    if (!fs.existsSync(snapshotPath)) return false;

    try {
      const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));

      // M-2: Validate schema before hydrating
      if (!this.isValidSnapshot(raw)) {
        logger.warn('Graph snapshot failed schema validation, will rebuild');
        return false;
      }

      const data = raw;

      // Version staleness check (added in schema v2): if the snapshot was
      // written by an older ctxloom binary — OR is a legacy v1 snapshot
      // with no ctxloomVersion field at all — force a rebuild. This
      // closes the "0 edges after upgrade" foot-gun where a snapshot
      // written before, say, absolute Python import resolution landed
      // would silently re-hydrate with empty edges on the next run.
      //
      // 'newer' is a no-op (downgrade isn't expected but shouldn't
      // crash); 'same' and 'unknown' (e.g. either side is 'dev') both
      // fall through to the file-count check below.
      const snapshotVer = data.ctxloomVersion;
      if (snapshotVer === undefined) {
        logger.info('Graph snapshot has no ctxloomVersion (legacy v1), rebuilding under current ctxloom', {
          current: CTXLOOM_VERSION,
        });
        return false;
      }
      const cmp = compareCtxloomVersions(snapshotVer, CTXLOOM_VERSION);
      if (cmp === 'older') {
        logger.info('Graph snapshot from older ctxloom, rebuilding', {
          snapshot: snapshotVer,
          current: CTXLOOM_VERSION,
        });
        return false;
      }
      if (cmp === 'newer') {
        logger.warn('Graph snapshot from newer ctxloom than installed binary; reusing but watch for shape drift', {
          snapshot: snapshotVer,
          current: CTXLOOM_VERSION,
        });
      }

      // Staleness check: if file count changed, force rebuild
      if (currentFileCount !== undefined && data.fileCount !== undefined) {
        if (data.fileCount !== currentFileCount) {
          logger.info('Graph snapshot stale, rebuilding', { prev: data.fileCount, curr: currentFileCount });
          return false;
        }
      }

      this.forwardEdges = new Map(
        Object.entries(data.forwardEdges).map(([k, v]) => [k, new Set(v as string[])])
      );
      this.reverseEdges = new Map(
        Object.entries(data.reverseEdges).map(([k, v]) => [k, new Set(v as string[])])
      );

      if (data.symbolIndex) {
        this.symbolIndex = new Map(Object.entries(data.symbolIndex));
      }

      // Try to load call graph snapshot (non-fatal if missing)
      const callPath = path.join(this.snapshotDir, 'call-graph-snapshot.json');
      if (fs.existsSync(callPath)) {
        try {
          const callRaw = JSON.parse(fs.readFileSync(callPath, 'utf-8'));
          this.callGraphIndex = CallGraphIndex.fromJSON(callRaw);
        } catch {
          this.callGraphIndex = new CallGraphIndex();
        }
      }

      return true;
    } catch (err) {
      logger.error('Failed to load graph snapshot, will rebuild', { detail: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  private resolveImport(fromAbs: string, specifier: string, rootDir: string): string | null {
    // CommonJS / TS-style relative import resolution.
    //
    // Why statSync().isFile() instead of existsSync(): existsSync returns
    // true for directories too. The original loop's first iteration uses
    // ext='' for "specifier already includes an extension" — but a bare
    // specifier like '..' resolves to a directory. existsSync would
    // match the directory and return the dir's relative path (often the
    // empty string for the repo root), creating broken edges.
    //
    // Concrete example surfaced by the bench spike on express:
    //   test/app.render.js: require('..')
    //   → path.resolve('test', '..') = <repoRoot> (a directory, exists)
    //   → without the isFile() check, edge was rootDir→'' (broken)
    //   → with the check, falls through to /index.js
    //   → correctly resolves to 'index.js'
    //
    // Order also matters: '/index.*' must come AFTER the bare extension
    // attempts so a real file './foo.js' isn't shadowed by './foo/index.js'
    // when both exist. The current order is correct on that count.
    //
    // Added .mjs and .cjs to cover modern Node modules + bench corpus repos
    // that use them. /index.mjs is rare but cheap to include.
    const dir = path.dirname(fromAbs);
    const extensions = [
      '',
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
      '/index.mjs', '/index.cjs',
    ];
    for (const ext of extensions) {
      const candidate = path.resolve(dir, specifier.replace(/\.js$/, '') + ext);
      try {
        if (fs.statSync(candidate).isFile()) {
          return path.relative(rootDir, candidate);
        }
      } catch {
        // ENOENT — try next extension. (statSync throws on missing files;
        // we use the throw as the "doesn't exist" signal rather than a
        // separate existsSync() call to halve the syscalls.)
      }
    }
    return null;
  }
}
