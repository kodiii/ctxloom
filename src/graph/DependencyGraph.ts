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
import { CallGraphIndex } from './CallGraphIndex.js';

/** Extensions handled by the TypeScript/JS AST parser. */
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
/** Extensions handled by the AST parser (TS/JS + Python + Go + Rust + Java). */
const AST_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.java']);

export interface GraphEdge {
  from: string;
  to: string;
}

export class DependencyGraph {
  /** file → set of files it imports (forward edges) */
  private forwardEdges = new Map<string, Set<string>>();
  /** file → set of files that import it (reverse edges) */
  private reverseEdges = new Map<string, Set<string>>();

  /** Symbol index: symbolName → { filePath, type, signature } */
  private symbolIndex = new Map<string, Array<{
    filePath: string;
    type: string;
    signature: string;
  }>>();

  private callGraphIndex = new CallGraphIndex();

  private parser: ASTParser | null = null;
  private rootDir: string = '';
  private snapshotDir: string = '';

  /**
   * Build the graph from all supported files in rootDir using AST parsing.
   */
  async buildFromDirectory(rootDir: string): Promise<void> {
    this.rootDir = rootDir;
    this.snapshotDir = path.join(rootDir, '.ctxloom');

    // Collect files first so we can pass the count to the snapshot staleness check
    const files = collectFiles(rootDir);

    // Try to hydrate from snapshot, passing current file count for staleness detection
    if (await this.loadSnapshot(files.length)) {
      logger.info('Loaded graph from snapshot', { edges: this.edgeCount() });
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
              if (!src.startsWith('.')) continue; // skip node_modules
              const resolved = this.resolveImport(absPath, src, rootDir);
              if (resolved) this.addEdge(relPath, resolved);
            }
          } else {
            // Python / Go / Rust / Java: regex extractor handles import graph edges
            // (TS-style resolver does not know Python/Go/Rust/Java path conventions)
            const content = fs.readFileSync(absPath, 'utf-8');
            const rawImports = extractImports(absPath, content);
            for (const raw of rawImports) {
              const resolved = resolveMultiLangImport(absPath, raw, rootDir);
              if (resolved) this.addEdge(relPath, resolved);
            }
          }

          // Symbol indexing for all AST-parsed languages
          for (const node of nodes) {
            if (node.type === 'function' || node.type === 'class' || node.type === 'interface') {
              const existing = this.symbolIndex.get(node.name) ?? [];
              existing.push({
                filePath: relPath,
                type: node.type,
                signature: node.signature ?? `${node.type} ${node.name}`,
              });
              this.symbolIndex.set(node.name, existing);
            }
          }

          // Call graph edges: TypeScript/JS only
          if (TS_EXTENSIONS.has(ext)) {
            const callEdges = await this.parser.parseAllCallEdges(absPath);
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

    // Save snapshot
    await this.saveSnapshot();
    logger.info('Graph built', { files: files.length, edges: this.edgeCount() });
  }

  /**
   * Set the ASTParser instance (avoids re-initialization).
   */
  setParser(parser: ASTParser): void {
    this.parser = parser;
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

    const relPath = path.relative(rootDir, absPath);

    // 1. Remove stale edges and symbol index entries for this file
    this.removeFile(relPath);
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
            if (!src.startsWith('.')) continue;
            const resolved = this.resolveImport(absPath, src, rootDir);
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

        // 3. Rebuild symbol index entries from this file
        for (const node of nodes) {
          if (node.type === 'function' || node.type === 'class' || node.type === 'interface') {
            const existing = this.symbolIndex.get(node.name) ?? [];
            existing.push({
              filePath: relPath,
              type: node.type,
              signature: node.signature ?? `${node.type} ${node.name}`,
            });
            this.symbolIndex.set(node.name, existing);
          }
        }

        // Rebuild call graph edges: TypeScript/JS only (stale edges were cleared above).
        if (TS_EXTENSIONS.has(ext)) {
          const callEdges = await this.parser.parseAllCallEdges(absPath);
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
      version: 1,
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

    // L-3: Atomic write via temp file + rename to prevent partial reads
    const snapshotPath = this.getSnapshotPath();
    const tmpPath = snapshotPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, snapshotPath);

    // Save call graph snapshot alongside import graph snapshot
    const callData = this.callGraphIndex.toJSON();
    const callPath = path.join(this.snapshotDir, 'call-graph-snapshot.json');
    const callTmp = callPath + '.tmp';
    fs.writeFileSync(callTmp, JSON.stringify(callData));
    fs.renameSync(callTmp, callPath);
  }

  /** M-2: Validate snapshot shape before hydrating to prevent prototype pollution. */
  private isValidSnapshot(data: unknown): data is {
    version: number;
    forwardEdges: Record<string, string[]>;
    reverseEdges: Record<string, string[]>;
    fileCount?: number;
    symbolIndex?: Record<string, Array<{ filePath: string; type: string; signature: string }>>;
  } {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    if (typeof d['version'] !== 'number') return false;
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
    const dir = path.dirname(fromAbs);
    for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']) {
      const candidate = path.resolve(dir, specifier.replace(/\.js$/, '') + ext);
      if (fs.existsSync(candidate)) {
        return path.relative(rootDir, candidate);
      }
    }
    return null;
  }
}
