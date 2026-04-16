/**
 * CallGraphIndex — Pre-built index of actual call-site edges.
 *
 * Maps callee symbol names → set of "callerFile:callerSymbol" keys.
 * Built by parsing call_expression AST nodes in TypeScript/TSX files.
 *
 * Separate from the import graph (DependencyGraph):
 *   Import graph: file-level "which files depend on which"
 *   Call graph:   symbol-level "which functions call which"
 */

export interface CallEdge {
  callerFile: string;    // relative path
  callerSymbol: string;  // enclosing function/class containing the call, or '' for top-level
  calleeSymbol: string;  // name of the called symbol
  line: number;
}

type Serialized = { bySite: Record<string, string[]> };

export class CallGraphIndex {
  /** calleeSymbol → Set<"callerFile:callerSymbol"> (reverse lookup) */
  private bySite = new Map<string, Set<string>>();
  /** "callerFile:callerSymbol" → Set<calleeSymbol> (forward lookup) */
  private byCallerKey = new Map<string, Set<string>>();

  addEdge(edge: CallEdge): void {
    const { callerFile, callerSymbol, calleeSymbol } = edge;

    // Reverse index: callee → callers
    if (!this.bySite.has(calleeSymbol)) {
      this.bySite.set(calleeSymbol, new Set());
    }
    this.bySite.get(calleeSymbol)!.add(`${callerFile}:${callerSymbol}`);

    // Forward index: caller → callees
    const callerKey = `${callerFile}:${callerSymbol}`;
    if (!this.byCallerKey.has(callerKey)) {
      this.byCallerKey.set(callerKey, new Set());
    }
    this.byCallerKey.get(callerKey)!.add(calleeSymbol);
  }

  /**
   * Returns all symbols called by the given function in the given file.
   */
  getCallees(callerFile: string, callerSymbol: string): string[] {
    const key = `${callerFile}:${callerSymbol}`;
    return Array.from(this.byCallerKey.get(key) ?? []);
  }

  /**
   * Returns all files that contain the symbol as a caller (i.e., files where
   * this symbol has outgoing call edges). Used to resolve callee definition
   * file when the symbol index has no entry (e.g. in test graphs).
   */
  findFilesForCallerSymbol(symbol: string): string[] {
    const suffix = `:${symbol}`;
    const files: string[] = [];
    for (const key of this.byCallerKey.keys()) {
      if (key.endsWith(suffix)) {
        files.push(key.slice(0, key.length - suffix.length));
      }
    }
    return files;
  }

  /**
   * Returns all callers of the given symbol across all indexed files.
   */
  getCallers(symbol: string): Array<{ file: string; symbol: string }> {
    return Array.from(this.bySite.get(symbol) ?? []).map(key => {
      const idx = key.indexOf(':');
      return idx >= 0
        ? { file: key.slice(0, idx), symbol: key.slice(idx + 1) }
        : { file: key, symbol: '' };
    });
  }

  /**
   * Remove all call edges where callerFile is the given file.
   * Called before re-indexing a file to prevent stale edges.
   */
  removeEdgesForFile(callerFile: string): void {
    const prefix = callerFile + ':';

    // Clean reverse index
    for (const [callee, callerKeys] of this.bySite.entries()) {
      for (const key of callerKeys) {
        if (key === callerFile || key.startsWith(prefix)) {
          callerKeys.delete(key);
        }
      }
      if (callerKeys.size === 0) {
        this.bySite.delete(callee);
      }
    }

    // Clean forward index
    for (const key of this.byCallerKey.keys()) {
      if (key === callerFile || key.startsWith(prefix)) {
        this.byCallerKey.delete(key);
      }
    }
  }

  /** Total number of distinct caller→callee edges. */
  size(): number {
    let n = 0;
    for (const s of this.bySite.values()) n += s.size;
    return n;
  }

  toJSON(): Serialized {
    return {
      bySite: Object.fromEntries(
        Array.from(this.bySite.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
    };
  }

  static fromJSON(data: unknown): CallGraphIndex {
    const idx = new CallGraphIndex();
    if (!data || typeof data !== 'object') return idx;
    const { bySite } = data as Partial<Serialized>;
    if (!bySite || typeof bySite !== 'object') return idx;
    for (const [callee, callerKeys] of Object.entries(bySite)) {
      if (Array.isArray(callerKeys) && callerKeys.every(k => typeof k === 'string')) {
        idx.bySite.set(callee, new Set(callerKeys));
        // Reconstruct forward index from serialized reverse index
        for (const callerKey of callerKeys) {
          if (!idx.byCallerKey.has(callerKey)) {
            idx.byCallerKey.set(callerKey, new Set());
          }
          idx.byCallerKey.get(callerKey)!.add(callee);
        }
      }
    }
    return idx;
  }
}
