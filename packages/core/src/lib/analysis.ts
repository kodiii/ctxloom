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
  historicalCoupling: HistoricalCouplingEntry[];
  totalImpacted: number;
}

export interface ImpactInput {
  graph: DependencyGraph;
  overlay?: GitOverlayStore;
  changedFiles: string[];
  depth?: number;
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

export function getImpactRadius(input: ImpactInput): ImpactReport {
  const { graph, overlay, changedFiles, depth = 3 } = input;

  const { directImporters, allReachable } = traverseImporters(changedFiles, graph, depth);

  const transitiveImporters: string[] = [];
  for (const file of allReachable) {
    if (!directImporters.has(file)) transitiveImporters.push(file);
  }

  const staticSet = new Set<string>([
    ...changedFiles,
    ...directImporters,
    ...transitiveImporters,
  ]);

  const historicalCoupling =
    overlay !== undefined
      ? buildHistoricalCouplingEntries(changedFiles, staticSet, overlay)
      : [];

  const totalImpacted = directImporters.size + transitiveImporters.length;

  return {
    seedFiles: [...changedFiles],
    directImporters: Array.from(directImporters),
    transitiveImporters,
    historicalCoupling,
    totalImpacted,
  };
}
