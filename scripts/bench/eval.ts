#!/usr/bin/env tsx
/**
 * Bench orchestrator — wires corpus → ground truth → checkout → index →
 * predict → metrics → tokens → report.
 *
 * Entry points exposed via package.json scripts:
 *   npm run bench:spike  — gate run on SPIKE_CORPUS
 *   npm run bench:full   — full publication run on FULL_CORPUS
 *
 * Stage flag (passed by the npm script wrappers) gates which corpus
 * runs and whether gate logic applies.
 *
 * Pre-conditions:
 *   - ctxloom on PATH (or CTXLOOM_BIN env)
 *   - CTXLOOM_LICENSE_KEY set
 *   - `gh` CLI authenticated
 *   - ~3 GB disk free at $BENCH_CACHE
 *
 * Token-reduction measurement is deferred to a follow-up commit —
 * the existing `benchmarks/benchmark-public-repos.ts` already
 * measures aggregate token reduction; this harness focuses on
 * F1/precision/recall first since those are the credibility
 * gate, then folds in tokens once we have a working spike.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPIKE_CORPUS, FULL_CORPUS, GATE } from './corpus.js';
import { fetchGroundTruth, isSourceFile } from './groundTruth.js';
import { ensureWorktree } from './repoCheckout.js';
import { indexRepo, blastRadius, buildOverlay, buildVectorStore } from './predict.js';
import { computeMetrics, computeGraphReachability, avg } from './metrics.js';
import { auditSymbolDeclarations, auditImportEdges } from './graph-correctness.js';
import { DependencyGraph } from '@ctxloom/core';
import { writeReport } from './report.js';
import type { BenchReport, RepoReport, CorpusEntry, Metrics, TokenMetrics, GraphCorrectnessMetrics } from './types.js';

// ESM has no __dirname / __filename. Without these the spike runs to
// completion, computes correct F1 numbers per PR, then crashes during
// report-write — losing the data. The package is "type": "module" so
// this file runs as ESM under tsx.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Stage = 'spike' | 'full';

function getStage(): Stage {
  const argStage = process.argv[2];
  if (argStage === 'spike' || argStage === 'full') return argStage;
  throw new Error(`Usage: tsx eval.ts <spike|full>. Got: ${argStage}`);
}

/**
 * Average a list of coverage values, treating -1 as "not applicable"
 * (e.g. import coverage on a pure-Go repo). The marker -1 is filtered
 * out so it doesn't drag a perfectly-fine 1.0 average down to ~0.5.
 *
 * If every value is N/A the result is itself -1, which the report
 * renderer surfaces as "n/a" — distinct from a real 0.0 score.
 */
function avgSkippingNA(values: readonly number[]): number {
  const applicable = values.filter((v) => v >= 0);
  if (applicable.length === 0) return -1;
  return applicable.reduce((sum, v) => sum + v, 0) / applicable.length;
}

function getCtxloomSha(): string {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
    cwd: path.resolve(__dirname, '..', '..'),
  }).trim();
}

/**
 * Process one corpus entry: clone, then for each PR run ground-truth
 * fetch → worktree → index → predict → metrics.
 *
 * Token measurements are placeholder (zeros) — wired in a follow-up
 * commit alongside `scripts/bench/tokens.ts`.
 */
async function runRepo(entry: CorpusEntry): Promise<RepoReport> {
  // eslint-disable-next-line no-console -- bench output goes to stderr
  console.error(`\n=== ${entry.repo} (${entry.prs.length} PRs) ===`);
  const perPr: Array<Metrics & TokenMetrics & GraphCorrectnessMetrics> = [];

  for (const prNumber of entry.prs) {
    console.error(`  PR #${prNumber}: fetching ground truth...`);
    const gt = fetchGroundTruth(entry.repo, prNumber);
    console.error(`    ground-truth files: ${gt.groundTruthFiles.length}`);
    console.error(`    entry point: ${gt.entryPoint}`);
    console.error(`    eval SHA (post-merge): ${gt.evalSha.slice(0, 7)}`);

    const worktree = ensureWorktree(entry.repo, prNumber, gt.evalSha);
    console.error(`  PR #${prNumber}: indexing ${worktree}...`);
    indexRepo(worktree);

    // Build / load the git overlay for this worktree. The overlay
    // tracks co-change pairs from the git history — the signal that
    // surfaces behavioral test↔lib relationships the static graph
    // misses (e.g. fastapi streaming tests modified together with
    // routing.py but never importing APIRouter directly).
    console.error(`  PR #${prNumber}: building git overlay (co-change signal)...`);
    const overlayStart = Date.now();
    const overlay = await buildOverlay(worktree);
    console.error(`    overlay ${overlay ? 'ready' : 'unavailable'} · ${((Date.now() - overlayStart) / 1000).toFixed(1)}s`);

    console.error(`  PR #${prNumber}: opening vector store (semantic signal)...`);
    const vsStart = Date.now();
    const vectorStore = await buildVectorStore(worktree);
    console.error(`    vector store ${vectorStore ? 'ready' : 'unavailable'} · ${((Date.now() - vsStart) / 1000).toFixed(1)}s`);

    console.error(`  PR #${prNumber}: computing blast radius from ${gt.entryPoint}...`);
    const prediction = await blastRadius(worktree, gt.entryPoint, prNumber, overlay, vectorStore);
    console.error(`    predicted files: ${prediction.predictedFiles.length}`);

    const metrics = computeMetrics(
      prNumber,
      gt.groundTruthFiles,
      prediction.predictedFiles,
      isSourceFile,
    );

    // Graph reachability — independent of the prediction algorithm.
    // Walks the import graph via BFS from the entry point and measures
    // what fraction of the source-file GT is structurally connectable.
    // Isolates graph completeness from algorithm quality (see
    // metrics.ts:computeGraphReachability for the design rationale).
    const auditGraph = new DependencyGraph();
    const loaded = await auditGraph.loadSnapshotOnly(worktree);
    let symbolCoverage = 0;
    let astDeclared = 0;
    let graphIndexed = 0;
    let importCoverage = 0;
    let astRelativeImports = 0;
    let graphImportEdges = 0;
    if (loaded) {
      const sourceTruth = gt.groundTruthFiles.filter(isSourceFile);
      const { reachable, reachability } = computeGraphReachability(
        gt.entryPoint,
        sourceTruth,
        auditGraph,
      );
      metrics.graphReachable = reachable;
      metrics.graphReachability = reachability;

      // Graph-correctness audit — symbol declaration coverage.
      // Directly compares AST-parsed declarations against
      // graph.symbolIndex; measures graph correctness without any
      // prediction algorithm in between. The primary test of the
      // "absurd accuracy across all project files" claim.
      console.error(`  PR #${prNumber}: auditing symbol declaration coverage...`);
      try {
        const report = await auditSymbolDeclarations(worktree, auditGraph);
        symbolCoverage = report.coverage;
        astDeclared = report.astDeclared;
        graphIndexed = report.graphIndexed;
        console.error(
          `    symbol coverage: ${(report.coverage * 100).toFixed(1)}% ` +
          `(${report.graphIndexed}/${report.astDeclared} declarations indexed)`,
        );
        if (report.coverage < 0.95 && report.sampleMissed.length > 0) {
          console.error(`    sample missed (top ${report.sampleMissed.length}):`);
          for (const m of report.sampleMissed.slice(0, 5)) {
            console.error(`      ${m.type} ${m.symbol} in ${m.file}`);
          }
        }
      } catch (err) {
        console.error(`    symbol coverage audit failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Import edge coverage — direct measure of the import resolver
      // against AST ground truth. Per-extension breakdown isolates
      // language-specific resolver bugs (e.g. gin's Go path).
      console.error(`  PR #${prNumber}: auditing import edge coverage...`);
      try {
        const report = await auditImportEdges(worktree, auditGraph);
        astRelativeImports = report.astRelativeImports;
        graphImportEdges = report.graphEdges;
        if (report.notApplicable) {
          // N/A: pure-Go corpora that use module-path imports
          // exclusively don't satisfy the relative-import heuristic.
          // Marker value -1 lets aggregation skip these without
          // counting them as 0 (a false bug signal) or 1 (false win).
          importCoverage = -1;
          console.error(`    import coverage: n/a (no relative-style imports in this corpus — needs Go-aware audit)`);
        } else {
          importCoverage = report.coverage ?? 0;
          console.error(
            `    import coverage: ${(importCoverage * 100).toFixed(1)}% ` +
            `(${report.graphEdges}/${report.astRelativeImports} edges, ${report.filesAudited} files)`,
          );
          // Per-extension diagnostic — only emit if any extension is
          // notably worse than the overall ratio (indicates a
          // language-specific resolver gap worth flagging).
          if (importCoverage < 0.9 && Object.keys(report.byExtension).length > 1) {
            console.error(`    per-extension:`);
            for (const [ext, stats] of Object.entries(report.byExtension)) {
              const ratio = stats.ast === 0 ? 1 : Math.min(1, stats.graph / stats.ast);
              console.error(`      ${ext}: ${(ratio * 100).toFixed(1)}% (${stats.graph}/${stats.ast}, ${stats.files} files)`);
            }
          }
        }
      } catch (err) {
        console.error(`    import coverage audit failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.error(
      `    F1=${metrics.f1.toFixed(2)} P=${metrics.precision.toFixed(2)} ` +
      `R=${metrics.recall.toFixed(2)} ` +
      `sourceR=${metrics.sourceRecall.toFixed(2)} ` +
      `graphReach=${metrics.graphReachability.toFixed(2)} ` +
      `symCov=${symbolCoverage.toFixed(2)} ` +
      `impCov=${importCoverage.toFixed(2)} ` +
      `(${metrics.sourceTruePositives}/${metrics.sourceGroundTruthCount} source, ` +
      `${metrics.graphReachable} reachable)`,
    );

    // Token metrics placeholder — TODO wire scripts/bench/tokens.ts
    perPr.push({
      ...metrics,
      naiveTokens: 0,
      graphTokens: 0,
      reduction: 0,
      symbolCoverage,
      astDeclared,
      graphIndexed,
      importCoverage,
      astRelativeImports,
      graphImportEdges,
    });
  }

  return {
    name: entry.name,
    prCount: perPr.length,
    avgF1: avg(perPr.map((p) => p.f1)),
    avgPrecision: avg(perPr.map((p) => p.precision)),
    avgRecall: avg(perPr.map((p) => p.recall)),
    avgSourceRecall: avg(perPr.map((p) => p.sourceRecall)),
    avgGraphReachability: avg(perPr.map((p) => p.graphReachability)),
    avgSymbolCoverage: avg(perPr.map((p) => p.symbolCoverage)),
    // -1 marker = N/A (e.g. pure-Go corpora that lack relative imports).
    // Skip those PRs when averaging — otherwise a fake-low denominator
    // would smear a real metric with non-applicable cells. If ALL PRs
    // for a repo are N/A the average is itself N/A (-1), surfaced as
    // "n/a" in the report renderer.
    avgImportCoverage: avgSkippingNA(perPr.map((p) => p.importCoverage)),
    avgNaiveTokens: avg(perPr.map((p) => p.naiveTokens)),
    avgGraphTokens: avg(perPr.map((p) => p.graphTokens)),
    avgReduction: avg(perPr.map((p) => p.reduction)),
    perPr,
  };
}

function evaluateGate(repos: RepoReport[]): BenchReport['gate'] {
  const overallF1 = avg(repos.map((r) => r.avgF1));
  const overallSourceRecall = avg(repos.map((r) => r.avgSourceRecall));
  const f1Pass = overallF1 >= GATE.f1Threshold;
  const sourceRecallPass = overallSourceRecall >= GATE.sourceRecallThreshold;
  // OR criterion: passing either branch is enough. See `GATE` comment
  // for the bimodal-corpus rationale.
  const passed = f1Pass || sourceRecallPass;

  let reason: string;
  if (passed) {
    const branch = f1Pass && sourceRecallPass
      ? `F1 ${overallF1.toFixed(2)} ≥ ${GATE.f1Threshold} AND sourceRecall ${overallSourceRecall.toFixed(2)} ≥ ${GATE.sourceRecallThreshold}`
      : f1Pass
        ? `F1 ${overallF1.toFixed(2)} ≥ ${GATE.f1Threshold} (sourceRecall ${overallSourceRecall.toFixed(2)} below ${GATE.sourceRecallThreshold} floor — high precision on small/focused PRs)`
        : `sourceRecall ${overallSourceRecall.toFixed(2)} ≥ ${GATE.sourceRecallThreshold} (F1 ${overallF1.toFixed(2)} below ${GATE.f1Threshold} floor — high recall on broad-impact PRs)`;
    reason = `${branch}. Proceed to full bench.`;
  } else {
    reason = `F1 ${overallF1.toFixed(2)} < ${GATE.f1Threshold} AND sourceRecall ${overallSourceRecall.toFixed(2)} < ${GATE.sourceRecallThreshold}. STOP — graph quality blocker on both axes. Do not publish.`;
  }

  return {
    passed,
    reason,
    f1Threshold: GATE.f1Threshold,
    sourceRecallThreshold: GATE.sourceRecallThreshold,
  };
}

async function main(): Promise<void> {
  const stage = getStage();
  const corpus = stage === 'spike' ? SPIKE_CORPUS : FULL_CORPUS;

  console.error(`Running ${stage} bench on ${corpus.length} repos.`);

  // Serial — concurrent indexing would compete for CPU and the disk
  // state is shared per repo (.ctxloom/snapshots in the worktree).
  const repos: RepoReport[] = [];
  for (const entry of corpus) {
    repos.push(await runRepo(entry));
  }
  const allPrs = repos.flatMap((r) => r.perPr);

  const report: BenchReport = {
    generatedAt: new Date().toISOString(),
    ctxloomSha: getCtxloomSha(),
    stage,
    overall: {
      repoCount: repos.length,
      prCount: allPrs.length,
      avgF1: avg(allPrs.map((p) => p.f1)),
      avgPrecision: avg(allPrs.map((p) => p.precision)),
      avgRecall: avg(allPrs.map((p) => p.recall)),
      avgSourceRecall: avg(allPrs.map((p) => p.sourceRecall)),
      avgGraphReachability: avg(allPrs.map((p) => p.graphReachability)),
      avgSymbolCoverage: avg(allPrs.map((p) => p.symbolCoverage)),
      avgImportCoverage: avgSkippingNA(allPrs.map((p) => p.importCoverage)),
      avgReduction: avg(allPrs.map((p) => p.reduction)),
    },
    repos,
  };

  if (stage === 'spike') {
    report.gate = evaluateGate(repos);
  }

  const outDir = path.resolve(__dirname, '..', '..', 'evaluate', 'reports');
  const outPath = writeReport(report, outDir);
  console.error(`\nReport written to ${outPath}`);

  if (stage === 'spike' && report.gate && !report.gate.passed) {
    console.error(`\nGATE FAILED: ${report.gate.reason}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Bench failed:', err);
  process.exit(1);
});
