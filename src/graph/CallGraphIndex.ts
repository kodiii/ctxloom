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

export type EdgeConfidence = 'extracted' | 'inferred' | 'ambiguous';

export interface CallEdge {
  callerFile: string;    // relative path
  callerSymbol: string;  // enclosing function/class containing the call, or '' for top-level
  calleeSymbol: string;  // name of the called symbol
  line?: number;
  confidence: EdgeConfidence;
}

export interface CallerEntry {
  file: string;
  symbol: string;
  callerSymbol: string;
  confidence: EdgeConfidence;
}

type SerializedEdge = { callerKey: string; confidence: EdgeConfidence };
type Serialized = { bySite: Record<string, SerializedEdge[]> };

export class CallGraphIndex {
  /** calleeSymbol → Map<"callerFile:callerSymbol", EdgeConfidence> (reverse lookup) */
  private bySite = new Map<string, Map<string, EdgeConfidence>>();
  /** "callerFile:callerSymbol" → Set<calleeSymbol> (forward lookup) */
  private byCallerKey = new Map<string, Set<string>>();

  addEdge(edge: Omit<CallEdge, 'confidence'> & { confidence?: EdgeConfidence }): void {
    const { callerFile, callerSymbol, calleeSymbol } = edge;
    const confidence: EdgeConfidence = edge.confidence ?? 'extracted';

    // Reverse index: callee → callers with confidence
    if (!this.bySite.has(calleeSymbol)) {
      this.bySite.set(calleeSymbol, new Map());
    }
    this.bySite.get(calleeSymbol)!.set(`${callerFile}:${callerSymbol}`, confidence);

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
   * Optionally filters by confidence tier.
   */
  getCallers(symbol: string, confidenceFilter?: EdgeConfidence): CallerEntry[] {
    const callerMap = this.bySite.get(symbol);
    if (!callerMap) return [];

    const results: CallerEntry[] = [];
    for (const [key, confidence] of callerMap.entries()) {
      if (confidenceFilter !== undefined && confidence !== confidenceFilter) {
        continue;
      }
      const idx = key.indexOf(':');
      const file = idx >= 0 ? key.slice(0, idx) : key;
      const symbol_ = idx >= 0 ? key.slice(idx + 1) : '';
      results.push({ file, symbol: symbol_, callerSymbol: symbol_, confidence });
    }
    return results;
  }

  /**
   * Remove all call edges where callerFile is the given file.
   * Called before re-indexing a file to prevent stale edges.
   */
  removeEdgesForFile(callerFile: string): void {
    const prefix = callerFile + ':';

    // Clean reverse index
    for (const [callee, callerMap] of this.bySite.entries()) {
      for (const key of callerMap.keys()) {
        if (key === callerFile || key.startsWith(prefix)) {
          callerMap.delete(key);
        }
      }
      if (callerMap.size === 0) {
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
    for (const m of this.bySite.values()) n += m.size;
    return n;
  }

  toJSON(): Serialized {
    return {
      bySite: Object.fromEntries(
        Array.from(this.bySite.entries()).map(([callee, callerMap]) => [
          callee,
          Array.from(callerMap.entries()).map(([callerKey, confidence]) => ({ callerKey, confidence })),
        ])
      ),
    };
  }

  static fromJSON(data: unknown): CallGraphIndex {
    const idx = new CallGraphIndex();
    if (!data || typeof data !== 'object') return idx;
    const { bySite } = data as Partial<Serialized>;
    if (!bySite || typeof bySite !== 'object') return idx;

    for (const [callee, edges] of Object.entries(bySite)) {
      if (!Array.isArray(edges)) continue;

      for (const edge of edges) {
        // Support both new format ({ callerKey, confidence }) and
        // legacy format (plain string) for backward compatibility.
        if (typeof edge === 'string') {
          // Legacy: plain "callerFile:callerSymbol" string, no confidence stored
          if (!idx.bySite.has(callee)) {
            idx.bySite.set(callee, new Map());
          }
          idx.bySite.get(callee)!.set(edge, 'extracted');
          if (!idx.byCallerKey.has(edge)) {
            idx.byCallerKey.set(edge, new Set());
          }
          idx.byCallerKey.get(edge)!.add(callee);
        } else if (edge && typeof edge === 'object' && 'callerKey' in edge) {
          const { callerKey, confidence } = edge as SerializedEdge;
          if (typeof callerKey !== 'string') continue;
          const resolvedConfidence: EdgeConfidence =
            confidence === 'inferred' || confidence === 'ambiguous' ? confidence : 'extracted';
          if (!idx.bySite.has(callee)) {
            idx.bySite.set(callee, new Map());
          }
          idx.bySite.get(callee)!.set(callerKey, resolvedConfidence);
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
