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
 * Symbol names alone are ambiguous (multiple files can define `init`),
 * so we cross-check with the symbol index: a caller is only attributed
 * if the symbol is actually defined in one of the seed files.
 *
 * Ranking: a hub file like express's `lib/response.js` exports ~20
 * methods that get called from ~100 files across the repo. Returning
 * ALL 100 callers crashes precision. We rank by how many DISTINCT
 * symbols from the seed each caller invokes — a file calling 10 of
 * response.js's methods is clearly response-related; one calling
 * `send()` once may be testing something else. Top-K cap defaults
 * to 25 (≈ typical PR size).
 */
const SYMBOL_CALLERS_TOP_K = 25;

function collectSymbolCallers(
  changedFiles: readonly string[],
  graph: DependencyGraph,
): Set<string> {
  const changedSet = new Set(changedFiles);
  const callGraph = graph.getCallGraphIndex();

  // Count how many DISTINCT seed-defined symbols each caller invokes.
  const callerScores = new Map<string, number>();

  for (const file of changedFiles) {
    const symbols = graph.lookupSymbolsByFile(file);
    for (const sym of symbols) {
      // Confirm this symbol resolves to ONE of the seed files (avoids
      // attributing callers of an unrelated identically-named symbol).
      const defs = graph.lookupSymbol(sym);
      const definedInSeed = defs.some((d) => changedSet.has(d.filePath));
      if (!definedInSeed) continue;

      // De-dup per-symbol callers so we count "files that call this
      // symbol" once, not "every call site".
      const seenForSym = new Set<string>();
      for (const caller of callGraph.getCallers(sym)) {
        if (changedSet.has(caller.file)) continue;
        if (seenForSym.has(caller.file)) continue;
        seenForSym.add(caller.file);
        callerScores.set(caller.file, (callerScores.get(caller.file) ?? 0) + 1);
      }
    }
  }

  // Sort by score descending; tie-break by path for determinism.
  const ranked = Array.from(callerScores.entries()).sort((a, b) => {
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
