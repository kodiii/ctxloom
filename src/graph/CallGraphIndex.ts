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
  /** calleeSymbol → Set<"callerFile:callerSymbol"> */
  private bySite = new Map<string, Set<string>>();

  addEdge(edge: CallEdge): void {
    const { callerFile, callerSymbol, calleeSymbol } = edge;
    if (!this.bySite.has(calleeSymbol)) {
      this.bySite.set(calleeSymbol, new Set());
    }
    this.bySite.get(calleeSymbol)!.add(`${callerFile}:${callerSymbol}`);
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
      }
    }
    return idx;
  }
}
