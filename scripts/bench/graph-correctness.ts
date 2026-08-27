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
 *   2. Import edge coverage — % of independently resolved local
 *      import targets that are present in the graph. The audit has
 *      its own small JS/TS, Python, and Go resolver so it does not
 *      measure the production resolver against itself.
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
   * Number of independently resolved local source-target edges the
   * AST parser found. Go package imports can contribute more than one
   * expected edge because a package contains multiple source files.
   */
  expectedEdges: number;
  /**
   * Number of expected source-target edges that are actually present
   * in the graph. Unrelated graph edges never count as matches.
   */
  matchedEdges: number;
  /**
   * matchedEdges / expectedEdges. `null` when the supported audit
   * resolver cannot identify any local import targets in the corpus.
   */
  coverage: number | null;
  /** Number of files with at least one expected local import edge. */
  filesAudited: number;
  /**
   * Per-extension breakdown — surfaces language-specific resolver
   * gaps (e.g. Go .go files with low coverage isolate a Go-resolver
   * bug without polluting the JS/TS numbers).
   */
  byExtension: Record<string, { expected: number; matched: number; files: number }>;
  /** First N expected source-target edges missing from the graph. */
  sampleMissed: Array<{ source: string; target: string }>;
  /**
   * `true` when no independently resolvable local imports were found.
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
 *   - Parse imports with the AST parser.
 *   - Resolve local targets with the independent audit resolver below.
 *   - Check that each exact source-target edge exists in the graph.
 *   - Ratio = matched expected edges / all expected edges.
 *
 * Expected targets are deduplicated per source file. This prevents
 * repeated imports from inflating the denominator and, crucially,
 * prevents unrelated graph edges from hiding a missing import edge.
 *
 * Per-extension breakdown isolates language-specific resolver gaps:
 * if `gin` shows .go imports at 0.30 coverage but JS/TS/Py at 1.0,
 * the bug is in the Go resolver path specifically.
 */
const JS_IMPORT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']);
const JS_RESOLUTION_SUFFIXES = [
  '',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
  '/index.mjs', '/index.cjs',
];

function existingFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function normalizeRelative(repoPath: string, target: string): string {
  return path.relative(repoPath, target).replace(/\\/g, '/');
}

/**
 * Resolve import targets independently from DependencyGraph. Kept
 * deliberately small and corpus-scoped: JS/TS relative imports,
 * Python relative/absolute local imports, and Go module imports.
 */
function resolveAuditTargets(
  repoPath: string,
  fromAbs: string,
  extension: string,
  specifier: string,
  goModulePath: string | null,
): string[] {
  const fromDir = path.dirname(fromAbs);

  if (JS_IMPORT_EXTENSIONS.has(extension)) {
    if (!specifier.startsWith('.')) return [];
    const withoutJsSuffix = specifier.replace(/\.js$/, '');
    for (const suffix of JS_RESOLUTION_SUFFIXES) {
      const candidate = path.resolve(fromDir, withoutJsSuffix + suffix);
      if (candidate !== fromAbs && existingFile(candidate)) {
        return [normalizeRelative(repoPath, candidate)];
      }
    }
    return [];
  }

  if (extension === '.py') {
    const dots = specifier.match(/^(\.+)/)?.[1];
    let candidates: string[];
    if (dots) {
      let baseDir = fromDir;
      for (let i = 1; i < dots.length; i += 1) {
        baseDir = path.dirname(baseDir);
      }
      const modulePart = specifier.slice(dots.length).replace(/\./g, path.sep);
      candidates = modulePart
        ? [path.join(baseDir, `${modulePart}.py`), path.join(baseDir, modulePart, '__init__.py')]
        : [path.join(fromDir, '__init__.py')];
    } else {
      const modulePart = specifier.replace(/\./g, path.sep);
      candidates = [
        path.join(repoPath, `${modulePart}.py`),
        path.join(repoPath, modulePart, '__init__.py'),
        path.join(repoPath, 'src', `${modulePart}.py`),
        path.join(repoPath, 'src', modulePart, '__init__.py'),
      ];
    }
    const target = candidates.find((candidate) => candidate !== fromAbs && existingFile(candidate));
    return target ? [normalizeRelative(repoPath, target)] : [];
  }

  if (extension === '.go') {
    let targetDir: string | null = null;
    if (specifier.startsWith('.')) {
      targetDir = path.resolve(fromDir, specifier);
    } else if (goModulePath && specifier.startsWith(`${goModulePath}/`)) {
      targetDir = path.join(repoPath, specifier.slice(goModulePath.length + 1));
    }
    if (!targetDir) return [];
    try {
      return fs.readdirSync(targetDir)
        .filter((file) => file.endsWith('.go') && !file.endsWith('_test.go'))
        .sort()
        .map((file) => normalizeRelative(repoPath, path.join(targetDir, file)));
    } catch {
      return [];
    }
  }

  return [];
}

export async function auditImportEdges(
  repoPath: string,
  graph: DependencyGraph,
): Promise<ImportCoverageReport> {
  const parser = new ASTParser();
  await parser.init();

  const goModPath = path.join(repoPath, 'go.mod');
  const goModulePath = existingFile(goModPath)
    ? fs.readFileSync(goModPath, 'utf8').match(/^module\s+(\S+)/m)?.[1] ?? null
    : null;
  let expectedEdges = 0;
  let matchedEdges = 0;
  let filesAudited = 0;
  const byExtension: ImportCoverageReport['byExtension'] = {};
  const sampleMissed: ImportCoverageReport['sampleMissed'] = [];
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

    const expectedTargets = new Set<string>();
    for (const node of nodes) {
      if (node.type !== 'import') continue;
      const src = node.source ?? node.name;
      for (const target of resolveAuditTargets(repoPath, absPath, ext, src, goModulePath)) {
        expectedTargets.add(target);
      }
    }

    if (expectedTargets.size === 0) continue;
    filesAudited += 1;
    const actualTargets = new Set(graph.getImports(relPath).map((target) => target.replace(/\\/g, '/')));
    let fileMatches = 0;
    for (const target of expectedTargets) {
      if (actualTargets.has(target)) {
        fileMatches += 1;
      } else if (sampleMissed.length < MISSED_SAMPLE_CAP) {
        sampleMissed.push({ source: relPath.replace(/\\/g, '/'), target });
      }
    }

    expectedEdges += expectedTargets.size;
    matchedEdges += fileMatches;

    if (!byExtension[ext]) {
      byExtension[ext] = { expected: 0, matched: 0, files: 0 };
    }
    byExtension[ext].expected += expectedTargets.size;
    byExtension[ext].matched += fileMatches;
    byExtension[ext].files += 1;
  }

  // No independently resolved local targets means there is no audit
  // signal. Report N/A rather than a vacuous 100%.
  const notApplicable = expectedEdges === 0;
  const coverage: number | null = notApplicable
    ? null
    : matchedEdges / expectedEdges;

  return {
    expectedEdges,
    matchedEdges,
    coverage,
    filesAudited,
    byExtension,
    sampleMissed,
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
