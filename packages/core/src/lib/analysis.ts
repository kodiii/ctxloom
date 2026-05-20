/**
 * src/lib/analysis.ts
 *
 * Pure analysis functions extracted from MCP tool implementations.
 * These functions operate on DependencyGraph and GitOverlayStore directly,
 * with no MCP formatting or I/O side effects.
 */
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import type { GitOverlayStore } from '../git/GitOverlayStore.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type ChurnBucket = 'low' | 'medium' | 'high';

export interface OverlayRisk {
  churn: ChurnBucket;
  bugDensity: number;
  coupledNodes: Array<{ node: string; confidence: number }>;
  owners: Array<{ author: string; share: number }>;
}

// ---------------------------------------------------------------------------
// detectChanges types and implementation
// ---------------------------------------------------------------------------

export interface ChangedFile {
  file: string;
  riskLevel: RiskLevel;
  importerCount: number;
  isHub: boolean;
  hasTestCoverage: boolean;
  risk: OverlayRisk | null;
}

export interface DetectChangesInput {
  graph: DependencyGraph;
  overlay?: GitOverlayStore;
  changedFiles: string[];
  depth?: number;
}

export interface DetectChangesResult {
  changedFiles: ChangedFile[];
  summary: { critical: number; high: number; medium: number; low: number };
}

const TEST_PATTERN = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/;
const RISK_ORDER: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Files that don't carry executable code and therefore can't be
 * "tested" in the conventional sense. Penalizing them for "no test
 * coverage" produces nonsense results — a README.md change was
 * coming back as medium risk solely because there's no `README.test.md`.
 *
 * Conservative list: only extensions/patterns whose criticality is
 * universally low regardless of name. JSON/YAML/TOML are NOT included
 * — package.json, tsconfig.json, and workflow yaml all genuinely
 * affect runtime behavior and deserve coverage scrutiny.
 */
const NON_SOURCE_EXTENSIONS = /\.(?:md|mdx|markdown|txt|rst|adoc|lock|sum|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot|mp4|mov|webm|wav|mp3)$/i;

const NON_SOURCE_LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
]);

const NON_SOURCE_BASENAMES = /^(?:LICEN[CS]E|CHANGELOG|README|AUTHORS|CONTRIBUTORS|NOTICE)(?:\.[a-z]+)?$/i;

function isNonSourceFile(filePath: string): boolean {
  if (NON_SOURCE_EXTENSIONS.test(filePath)) return true;
  const basename = filePath.split('/').pop() ?? filePath;
  if (NON_SOURCE_LOCKFILES.has(basename)) return true;
  if (NON_SOURCE_BASENAMES.test(basename)) return true;
  return false;
}

function fileHasTestCoverage(filePath: string, graph: DependencyGraph): boolean {
  const importers = graph.getImporters(filePath);
  if (importers.some(f => TEST_PATTERN.test(f))) return true;
  const base = filePath.replace(/\.[^.]+$/, '');
  const stem = base.split('/').pop() ?? '';
  return graph.allFiles().some(f => TEST_PATTERN.test(f) && stem.length > 0 && f.includes(stem));
}

function computeFileRiskLevel(
  filePath: string,
  graph: DependencyGraph,
): { level: RiskLevel; importerCount: number; isHub: boolean; hasCoverage: boolean } {
  const isTest = TEST_PATTERN.test(filePath);
  const importerCount = graph.getImporters(filePath).length;
  const isHub = importerCount >= 5;
  // Non-source files (README, LICENSE, lockfiles, images) can't have
  // tests. Treat them as having coverage so the "no coverage = risk"
  // penalty doesn't apply. They still surface as `high` if they're a
  // hub somehow, which would be a meaningful signal (e.g. a shared
  // CHANGELOG that 20 packages link to).
  const isNonSource = isNonSourceFile(filePath);
  const hasCoverage = isTest || isNonSource || fileHasTestCoverage(filePath, graph);

  let level: RiskLevel;
  if (isTest || isNonSource) {
    // Non-source files start at low; only escalate if they're a hub.
    level = isHub ? 'high' : 'low';
  } else if (isHub && !hasCoverage) {
    level = 'critical';
  } else if (isHub || (!hasCoverage && importerCount > 2)) {
    level = 'high';
  } else if (!hasCoverage) {
    level = 'medium';
  } else if (importerCount > 2) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, importerCount, isHub, hasCoverage };
}

function bucketChurn(churnLines: number): ChurnBucket {
  if (churnLines < 100) return 'low';
  if (churnLines < 500) return 'medium';
  return 'high';
}

function buildOverlayRisk(filePath: string, overlay: GitOverlayStore): OverlayRisk {
  const churnStats = overlay.churn.statsFor(filePath);
  const ownStats = overlay.ownership.statsFor(filePath);
  const coupled = overlay.coChange.topFor({ node: filePath, limit: 3 }) ?? [];

  const churn: ChurnBucket =
    churnStats !== null && churnStats !== undefined
      ? bucketChurn(churnStats.churnLines)
      : 'low';

  const bugDensity = churnStats?.bugDensity ?? 0;

  const coupledNodes = coupled.map(c => ({
    node: c.nodeA === filePath ? c.nodeB : c.nodeA,
    confidence: c.confidence,
  }));

  const owners = (ownStats?.owners ?? []).map(o => ({
    author: o.author,
    share: o.share,
  }));

  return { churn, bugDensity, coupledNodes, owners };
}

export function detectChanges(input: DetectChangesInput): DetectChangesResult {
  const { graph, overlay, changedFiles } = input;

  const scored: ChangedFile[] = changedFiles.map(file => {
    const { level, importerCount, isHub, hasCoverage } = computeFileRiskLevel(file, graph);
    const risk = overlay !== undefined ? buildOverlayRisk(file, overlay) : null;

    return {
      file,
      riskLevel: level,
      importerCount,
      isHub,
      hasTestCoverage: hasCoverage,
      risk,
    };
  });

  scored.sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel]);

  const summary = {
    critical: scored.filter(s => s.riskLevel === 'critical').length,
    high: scored.filter(s => s.riskLevel === 'high').length,
    medium: scored.filter(s => s.riskLevel === 'medium').length,
    low: scored.filter(s => s.riskLevel === 'low').length,
  };

  return { changedFiles: scored, summary };
}

// ---------------------------------------------------------------------------
// getImpactRadius types and implementation
// ---------------------------------------------------------------------------

export interface HistoricalCouplingEntry {
  node: string;
  confidence: number;
  evidence: string;
}

export interface ImpactReport {
  seedFiles: string[];
  directImporters: string[];
  transitiveImporters: string[];
  /**
   * Files that the seed files DIRECTLY IMPORT (outbound edges).
   * Populated only when `includeImportees: true`.
   *
   * Captures the common PR pattern of co-modifying a file and its
   * dependencies — e.g. adding a method to `lib/response.js` that
   * touches helpers in `lib/utils.js`.
   */
  directImportees: string[];
  /**
   * Files that contain call-sites against symbols defined in the
   * seed files. Populated only when `includeSymbolCallers: true`.
   *
   * Captures cross-module dependencies that file-level imports miss
   * — e.g. tests calling `res.send()` through the package main entry
   * rather than `require('../lib/response')` directly.
   */
  symbolCallers: string[];
  historicalCoupling: HistoricalCouplingEntry[];
  totalImpacted: number;
}

export interface ImpactInput {
  graph: DependencyGraph;
  overlay?: GitOverlayStore;
  changedFiles: string[];
  depth?: number;
  /**
   * Include direct importees of the seed files in the prediction
   * (files the seed depends on, not just files that depend on the seed).
   * Default false — preserves legacy behavior for `ctx_blast_radius`.
   */
  includeImportees?: boolean;
  /**
   * Include files that contain call-sites against symbols defined in
   * the seed files. Uses the pre-built call-graph index. Default
   * false — preserves legacy behavior for `ctx_blast_radius`.
   *
   * Particularly impactful for hub files whose exported API is called
   * from many other modules via a re-export / package main, where the
   * static import graph collapses to just the package entry.
   */
  includeSymbolCallers?: boolean;
}

function traverseImporters(
  changedFiles: string[],
  graph: DependencyGraph,
  depth: number,
): { directImporters: Set<string>; allReachable: Set<string> } {
  const changedSet = new Set(changedFiles);
  const directImporters = new Set<string>();
  const allReachable = new Set<string>();

  let frontier = new Set(changedFiles);

  for (let d = 0; d < depth; d++) {
    const nextFrontier = new Set<string>();
    for (const file of frontier) {
      for (const imp of graph.getImporters(file)) {
        if (changedSet.has(imp)) continue;
        if (d === 0) directImporters.add(imp);
        if (!allReachable.has(imp)) {
          allReachable.add(imp);
          nextFrontier.add(imp);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  return { directImporters, allReachable };
}

function buildHistoricalCouplingEntries(
  changedFiles: string[],
  staticSet: Set<string>,
  overlay: GitOverlayStore,
): HistoricalCouplingEntry[] {
  const now = Math.floor(Date.now() / 1000);
  const coupling: HistoricalCouplingEntry[] = [];

  for (const seedFile of changedFiles) {
    const coupled = overlay.coChange.topFor({ node: seedFile, limit: 10, minConfidence: 0.2 });
    for (const hit of coupled) {
      const sibling = hit.nodeA === seedFile ? hit.nodeB : hit.nodeA;
      if (!staticSet.has(sibling) && !coupling.some(h => h.node === sibling)) {
        const daysSinceLast = Math.round((now - hit.lastSharedTimestamp) / 86400);
        coupling.push({
          node: sibling,
          confidence: hit.confidence,
          evidence: `Changed together in ${hit.sharedCommits} commits; last co-change ${daysSinceLast} days ago.`,
        });
      }
    }
  }

  coupling.sort((a, b) => b.confidence - a.confidence);
  coupling.splice(10);

  return coupling;
}

/**
 * Collect direct importees of seed files — files that the seed
 * directly imports (outbound forward edges). Excludes seeds themselves
 * to avoid double-counting.
 */
function collectImportees(
  changedFiles: readonly string[],
  graph: DependencyGraph,
): Set<string> {
  const changedSet = new Set(changedFiles);
  const importees = new Set<string>();
  for (const file of changedFiles) {
    for (const imp of graph.getImports(file)) {
      if (!changedSet.has(imp)) importees.add(imp);
    }
  }
  return importees;
}

/**
 * Collect files that contain call-sites against symbols defined in the
 * seed files. Bridges the gap where the file-level import graph misses
 * cross-module relationships — e.g. tests that call `res.send()` go
 * through the package main entry, not via `require('./response')`.
 *
 * Ranking signals (v1.6.0 calibration, see bench/methodology.md):
 *
 *   1. Per-symbol SPECIFICITY weight = 1 / (number of definitions).
 *      Generic methods like `set`/`use` (defined in many places) score
 *      low; specific methods like `sendStatus`/`render` (defined once)
 *      score high. Filters generic noise; rewards callers that hit the
 *      seed's UNIQUE API surface.
 *
 *   2. PATH-PROXIMITY bonus. A caller whose path contains the seed's
 *      basename or short prefix (test/res.send.js for lib/response.js)
 *      gets +1.0. Captures the universal test-naming convention without
 *      needing to know the actual test runner.
 *
 *   3. Top-K truncation. After ranking by score = (1) + (2), keep only
 *      the top SYMBOL_CALLERS_TOP_K=25 callers. Tiebreak alphabetically.
 *
 * Why this matters: a hub file like express's `lib/response.js` is
 * called from ~100 files. Returning all 100 crashes precision (saw
 * F1=0.02 P=0.02 on bench before ranking landed). With specificity +
 * path-proximity, ~20 of those 100 actually correlate with the file's
 * concerns — tests for response handling, lib siblings that share
 * utilities. Those are what a real PR's blast radius should surface.
 */
const SYMBOL_CALLERS_TOP_K = 25;
const PATH_PROXIMITY_BONUS = 1.0;
/**
 * Minimum ranking score for a caller to enter the prediction set.
 *
 * Drops "incidental callers" — files that happen to call exactly one
 * generic seed symbol once, with no path-name relationship to the
 * seed. Without this floor, leaf-file or small-PR entries (express
 * #6903, GT=3) over-predict because top-K=25 keeps the floor of the
 * distribution.
 *
 * 1.0 = "at least one specific-method call (specificity weight 1.0
 * means the symbol is defined in exactly one place)" OR "any positive
 * specificity + path-name match" OR "multiple medium-specificity
 * symbols". Tuned against the spike corpus — see bench/methodology.md.
 *
 * Callers below this threshold are single-incidental-call cases (e.g.
 * one call to a generic symbol like `set`/`use`/`get` defined in many
 * files at once, with no path-name relation to the seed). Those add
 * noise without recall.
 */
const SYMBOL_CALLERS_MIN_SCORE = 1.0;

/**
 * Path-proximity scorer for symbolCallers ranking.
 *
 * Returns PATH_PROXIMITY_BONUS if the caller's path contains the seed
 * file's basename (without extension) OR the basename's first ≥3
 * characters, surrounded by separator/word-boundary characters.
 *
 * Examples:
 *   entry = "lib/response.js" → tokens = {response, res}
 *   "test/res.send.js"            → bonus (matches "res")
 *   "test/response.test.js"       → bonus (matches "response")
 *   "test/req.params.js"          → no bonus
 *   "benchmarks/middleware.js"    → no bonus
 *
 * Tokens shorter than 3 chars are skipped to avoid spurious matches.
 */
function pathProximityScore(callerFile: string, seedFile: string): number {
  const lastSlash = seedFile.lastIndexOf('/');
  const lastDot = seedFile.lastIndexOf('.');
  const stem = seedFile.slice(
    lastSlash + 1,
    lastDot > lastSlash ? lastDot : seedFile.length,
  );
  if (stem.length < 3) return 0;

  // Short prefix: half the stem length, min 3 chars. For "response"
  // this is "resp"; for "application" it's "appli"; for "view" it
  // would be "view" itself (4 chars, half=2 floor→2 below 3 so use 3).
  // We deliberately under-include the prefix (3 chars only) to catch
  // common abbreviations like "res", "req", "app".
  const shortPrefix = stem.slice(0, 3);
  const tokens = stem === shortPrefix ? [stem] : [stem, shortPrefix];

  const caller = callerFile.toLowerCase();
  for (const t of tokens) {
    const token = t.toLowerCase();
    // Word-boundary on either side: start-of-path, separator chars,
    // or end-of-string. Avoid matching "respond" when looking for "res".
    const re = new RegExp(`(?:^|[/_.\\-])${token}(?:[/_.\\-]|$)`);
    if (re.test(caller)) return PATH_PROXIMITY_BONUS;
  }
  return 0;
}

function collectSymbolCallers(
  changedFiles: readonly string[],
  graph: DependencyGraph,
): Set<string> {
  const changedSet = new Set(changedFiles);
  const callGraph = graph.getCallGraphIndex();

  // For each candidate caller, sum its specificity-weighted score and
  // add the path-proximity bonus exactly once.
  const callerScores = new Map<string, number>();
  const callersWithProximityApplied = new Set<string>();

  for (const file of changedFiles) {
    const symbols = graph.lookupSymbolsByFile(file);
    for (const sym of symbols) {
      // Confirm this symbol resolves to ONE of the seed files (avoids
      // attributing callers of an unrelated identically-named symbol).
      const defs = graph.lookupSymbol(sym);
      const definedInSeed = defs.some((d) => changedSet.has(d.filePath));
      if (!definedInSeed) continue;

      // Specificity weight: rare symbols carry more signal than common
      // ones. Pseudo-IDF — bounded in (0, 1].
      const specificity = 1 / defs.length;

      // De-dup per-symbol callers so a file that calls this symbol N
      // times counts as ONE +specificity contribution.
      const seenForSym = new Set<string>();
      for (const caller of callGraph.getCallers(sym)) {
        if (changedSet.has(caller.file)) continue;
        if (seenForSym.has(caller.file)) continue;
        seenForSym.add(caller.file);

        const prev = callerScores.get(caller.file) ?? 0;
        const next = prev + specificity;
        callerScores.set(caller.file, next);
      }
    }

    // Apply path-proximity ONCE per caller (additive bonus, not per-
    // symbol). Computed after the symbol pass so we already know which
    // callers exist.
    for (const callerFile of callerScores.keys()) {
      if (callersWithProximityApplied.has(callerFile)) continue;
      const bonus = pathProximityScore(callerFile, file);
      if (bonus > 0) {
        callerScores.set(callerFile, (callerScores.get(callerFile) ?? 0) + bonus);
      }
      callersWithProximityApplied.add(callerFile);
    }
  }

  // Drop callers below the score floor (incidental one-method calls
  // with no name-match signal). Then sort + truncate to top-K.
  const ranked = Array.from(callerScores.entries())
    .filter(([, score]) => score >= SYMBOL_CALLERS_MIN_SCORE)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });

  return new Set(ranked.slice(0, SYMBOL_CALLERS_TOP_K).map(([file]) => file));
}

export function getImpactRadius(input: ImpactInput): ImpactReport {
  const {
    graph,
    overlay,
    changedFiles,
    depth = 3,
    includeImportees = false,
    includeSymbolCallers = false,
  } = input;

  const { directImporters, allReachable } = traverseImporters(changedFiles, graph, depth);

  const transitiveImporters: string[] = [];
  for (const file of allReachable) {
    if (!directImporters.has(file)) transitiveImporters.push(file);
  }

  const importeesSet = includeImportees
    ? collectImportees(changedFiles, graph)
    : new Set<string>();
  const directImportees = Array.from(importeesSet);

  const symbolCallersSet = includeSymbolCallers
    ? collectSymbolCallers(changedFiles, graph)
    : new Set<string>();
  const symbolCallers = Array.from(symbolCallersSet);

  const staticSet = new Set<string>([
    ...changedFiles,
    ...directImporters,
    ...transitiveImporters,
    ...directImportees,
    ...symbolCallers,
  ]);

  const historicalCoupling =
    overlay !== undefined
      ? buildHistoricalCouplingEntries(changedFiles, staticSet, overlay)
      : [];

  const totalImpacted =
    directImporters.size + transitiveImporters.length + directImportees.length + symbolCallers.length;

  return {
    seedFiles: [...changedFiles],
    directImporters: Array.from(directImporters),
    transitiveImporters,
    directImportees,
    symbolCallers,
    historicalCoupling,
    totalImpacted,
  };
}
