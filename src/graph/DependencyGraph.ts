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

  private parser: ASTParser | null = null;
  private rootDir: string = '';
  private snapshotDir: string = '';

  /**
   * Build the graph from all supported files in rootDir using AST parsing.
   */
  async buildFromDirectory(rootDir: string): Promise<void> {
    this.rootDir = rootDir;
    this.snapshotDir = path.join(rootDir, '.contextmesh');

    // Collect files first so we can pass the count to the snapshot staleness check
    const files = collectFiles(rootDir);

    // Try to hydrate from snapshot, passing current file count for staleness detection
    if (await this.loadSnapshot(files.length)) {
      console.error(`[ContextMesh] Loaded graph from snapshot (${this.edgeCount()} edges)`);
      return;
    }

    // No usable snapshot — build from scratch
    if (!this.parser) {
      this.parser = new ASTParser();
      await this.parser.init();
    }

    for (const absPath of files) {
      const relPath = path.relative(rootDir, absPath);
      try {
        const nodes = await this.parser.parse(absPath);

        // Process imports
        const importNodes = nodes.filter(n => n.type === 'import');
        for (const imp of importNodes) {
          const src = imp.source ?? '';
          if (!src.startsWith('.')) continue; // skip node_modules

          const resolved = this.resolveImport(absPath, src, rootDir);
          if (resolved) {
            this.addEdge(relPath, resolved);
          }
        }

        // Process symbol definitions for symbol index
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
      } catch (err) {
        console.error(`[ContextMesh] Failed to parse ${relPath}:`, err instanceof Error ? err.message : String(err));
      }
    }

    // Save snapshot
    await this.saveSnapshot();
    console.error(`[ContextMesh] Graph built from ${files.length} files (${this.edgeCount()} edges)`);
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
   * Traverse the call graph bidirectionally with configurable depth.
   * direction: 'callers' = reverse edges (who imports me)
   *            'callees' = forward edges (who do I import)
   */
  traverse(startFile: string, direction: 'callers' | 'callees', depth: number = 1): string[] {
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

    fs.writeFileSync(this.getSnapshotPath(), JSON.stringify(data, null, 2));
  }

  private async loadSnapshot(currentFileCount?: number): Promise<boolean> {
    const snapshotPath = this.getSnapshotPath();
    if (!fs.existsSync(snapshotPath)) return false;

    try {
      const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));

      // Staleness check: if file count changed, force rebuild
      if (currentFileCount !== undefined && data.fileCount !== undefined) {
        if (data.fileCount !== currentFileCount) {
          console.error(`[ContextMesh] Graph snapshot stale (${data.fileCount} → ${currentFileCount} files), rebuilding...`);
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

      return true;
    } catch (err) {
      console.error('[ContextMesh] Failed to load graph snapshot (will rebuild):', err instanceof Error ? err.message : String(err));
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
