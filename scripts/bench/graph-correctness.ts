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

export interface ImportCoverageReport {
  /**
   * Number of distinct relative-import SOURCES the AST parser found
   * across the indexed files (deduped per-file by source-spec string).
   * Approximates "how many intra-repo import statements does the
   * source code contain?"
   */
  astRelativeImports: number;
  /**
   * Number of forwardEdges in the graph, summed across the same set
   * of files. Approximates "how many edges did the resolver actually
   * emit?"
   */
  graphEdges: number;
  /**
   * graphEdges / astRelativeImports, capped at 1.0. < 1.0 means the
   * import resolver is losing edges that the AST clearly identifies
   * as intra-repo imports. `null` when the corpus contains zero
   * relative-style imports (e.g. pure-Go repos that exclusively use
   * module-path imports) — coverage is undefined for that case
   * rather than vacuously 1.0.
   */
  coverage: number | null;
  /** Number of files with at least one relative import (denominator scope). */
  filesAudited: number;
  /**
   * Per-extension breakdown — surfaces language-specific resolver
   * gaps (e.g. Go .go files with low coverage isolate a Go-resolver
   * bug without polluting the JS/TS numbers).
   */
  byExtension: Record<string, { ast: number; graph: number; files: number }>;
  /**
   * `true` when the audit's relative-import heuristic doesn't apply
   * to this corpus — e.g. pure-Go repos that use module-path imports
   * exclusively. A separate Go-aware audit is needed (task #24
   * follow-up).
   */
  notApplicable: boolean;
}

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
/**
 * Audit import-edge coverage across a repo. For every indexed file:
 *
 *   - Parse with AST, collect distinct relative-import source specs
 *     (e.g. `.foo`, `../bar`, `./baz/qux`).
 *   - Count the graph's forwardEdges for that file.
 *   - Ratio = graphEdges / astRelativeImports (capped at 1.0).
 *
 * The dedup-by-source-spec choice is deliberate. The graph emits one
 * edge per resolved target file; the AST emits one node per import
 * statement. `from .x import a; from .x import b` is 1 unique source
 * spec but produces 2 ParsedNode entries. We dedupe to the source-
 * spec level so the ratio reflects "edges per intra-repo import
 * statement family" — closely matching what the resolver should
 * produce. Over-count (graph > AST) caps at 1.0; under-count is the
 * interesting failure mode (resolver missing edges).
 *
 * Per-extension breakdown isolates language-specific resolver gaps:
 * if `gin` shows .go imports at 0.30 coverage but JS/TS/Py at 1.0,
 * the bug is in the Go resolver path specifically.
 */
export async function auditImportEdges(
  repoPath: string,
  graph: DependencyGraph,
): Promise<ImportCoverageReport> {
  const parser = new ASTParser();
  await parser.init();

  let astRelativeImports = 0;
  let graphEdges = 0;
  let filesAudited = 0;
  const byExtension: Record<string, { ast: number; graph: number; files: number }> = {};

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

    // Distinct intra-repo import source specs (relative paths).
    // Bare module imports (e.g. `os`, `lodash`) intentionally skipped
    // — they target external packages, not files in this repo.
    const relativeImports = new Set<string>();
    for (const node of nodes) {
      if (node.type !== 'import') continue;
      const src = node.source ?? node.name;
      if (src.startsWith('.')) {
        relativeImports.add(src);
      }
    }

    if (relativeImports.size === 0) continue;
    filesAudited += 1;
    const fileEdges = graph.getImports(relPath).length;

    astRelativeImports += relativeImports.size;
    graphEdges += fileEdges;

    if (!byExtension[ext]) {
      byExtension[ext] = { ast: 0, graph: 0, files: 0 };
    }
    byExtension[ext].ast += relativeImports.size;
    byExtension[ext].graph += fileEdges;
    byExtension[ext].files += 1;
  }

  // When the heuristic finds zero relative imports (e.g. pure-Go
  // corpora that exclusively use module-path imports), the metric is
  // undefined rather than vacuously 1.0. The report surfaces this
  // explicitly so downstream tooling doesn't mistake "no signal" for
  // "perfect coverage".
  const notApplicable = astRelativeImports === 0;
  const coverage: number | null = notApplicable
    ? null
    : Math.min(1, graphEdges / astRelativeImports);

  return {
    astRelativeImports,
    graphEdges,
    coverage,
    filesAudited,
    byExtension,
    notApplicable,
  };
}

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
