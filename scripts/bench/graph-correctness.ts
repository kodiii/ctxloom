/**
 * Graph correctness audit — measures graph quality DIRECTLY against
 * AST ground truth, without any prediction algorithm or external
 * oracle in between.
 *
 * Two questions, two metrics:
 *
 *   1. Symbol declaration coverage:
 *      For every function/class/method/interface the AST parser
 *      finds in the indexed source, is it present in
 *      `graph.symbolIndex` with the correct file attribution?
 *      Metric: % of AST-declared symbols indexed correctly.
 *
 *      A graph that scores < 0.95 here cannot reliably answer
 *      "where is X defined?" — `ctx_get_definition` would miss
 *      one in twenty symbols.
 *
 *   2. (Future) Import edge coverage — % of AST static imports
 *      that resulted in a graph edge to the resolved file. Same
 *      shape, harder because it requires re-implementing the
 *      DependencyGraph's resolver from outside (otherwise we're
 *      measuring our resolver against itself). Filed as v1.7.0+.
 *
 * Why this matters:
 *
 *   The impact-radius bench (existing) measures one product use
 *   case — "given a file change, what's affected?". ctxloom is a
 *   project context engine and serves several other uses:
 *
 *     • Symbol lookup (`ctx_get_definition`)
 *     • Call-graph queries (`ctx_get_call_graph`)
 *     • Architectural overview (`ctx_architecture_overview`)
 *     • Semantic search (`ctx_search`)
 *
 *   Graph quality is the PRIMARY input to all of these. Measuring
 *   it directly — not through any single prediction algorithm —
 *   answers the "absurd accuracy" claim with evidence rather than
 *   inference. If symbolCoverage is 0.99 the graph genuinely knows
 *   where 99% of declared symbols live; if 0.70 it doesn't.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { DependencyGraph } from '@ctxloom/core';
import { ASTParser } from '../../packages/core/src/ast/ASTParser.js';

export interface SymbolCoverageReport {
  /** Number of (symbol, file) declarations the AST parser found. */
  astDeclared: number;
  /** Number of those declarations that the graph's symbolIndex contains
   *  with matching file attribution. */
  graphIndexed: number;
  /** graphIndexed / astDeclared. 1.0 means perfect graph correctness. */
  coverage: number;
  /**
   * First N missed declarations (debugging aid; bench output truncates
   * this so reviewing a low score is actionable).
   */
  sampleMissed: Array<{ symbol: string; file: string; type: string }>;
}

/** Source-file extensions whose declarations we expect in the index. */
const INDEXED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '.py', '.go', '.rs', '.java', '.kt', '.kts',
  '.cs', '.rb', '.swift', '.vue',
]);

/** Symbol types the graph indexes (mirrors DependencyGraph.ts filter). */
const INDEXED_TYPES = new Set(['function', 'class', 'interface', 'method']);

/**
 * Audit symbol declarations across a repo. The graph must already be
 * built; we walk graph.allFiles() to know which files were indexed,
 * then re-parse each with the AST parser to get ground-truth
 * declarations.
 *
 * Skips files outside INDEXED_EXTENSIONS — the graph doesn't claim
 * to index e.g. plain .c headers or YAML, so counting their lack of
 * declarations against us would be misattribution.
 *
 * Returns coverage 1.0 with zero declarations counted as "no symbols
 * to check" (vacuously true) rather than a failure, so empty
 * fixture-style files don't penalize the audit.
 */
export async function auditSymbolDeclarations(
  repoPath: string,
  graph: DependencyGraph,
): Promise<SymbolCoverageReport> {
  const parser = new ASTParser();
  await parser.init();

  let astDeclared = 0;
  let graphIndexed = 0;
  const missed: SymbolCoverageReport['sampleMissed'] = [];
  const MISSED_SAMPLE_CAP = 10;

  for (const relPath of graph.allFiles()) {
    const ext = path.extname(relPath).toLowerCase();
    if (!INDEXED_EXTENSIONS.has(ext)) continue;

    const absPath = path.join(repoPath, relPath);
    if (!fs.existsSync(absPath)) continue;

    let nodes;
    try {
      nodes = await parser.parse(absPath);
    } catch {
      continue;
    }

    for (const node of nodes) {
      if (!INDEXED_TYPES.has(node.type)) continue;
      // Skip anonymous declarations (e.g. `function () {}`) — no
      // symbol name to look up.
      if (!node.name) continue;

      astDeclared += 1;
      const entries = graph.lookupSymbol(node.name);
      const hit = entries.some((e) => e.filePath === relPath);
      if (hit) {
        graphIndexed += 1;
      } else if (missed.length < MISSED_SAMPLE_CAP) {
        missed.push({ symbol: node.name, file: relPath, type: node.type });
      }
    }
  }

  const coverage = astDeclared === 0 ? 1.0 : graphIndexed / astDeclared;
  return { astDeclared, graphIndexed, coverage, sampleMissed: missed };
}
