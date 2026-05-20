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
import { computeMetrics, avg } from './metrics.js';
import { writeReport } from './report.js';
import type { BenchReport, RepoReport, CorpusEntry, Metrics, TokenMetrics } from './types.js';

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
  const perPr: Array<Metrics & TokenMetrics> = [];

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
    console.error(
      `    F1=${metrics.f1.toFixed(2)} P=${metrics.precision.toFixed(2)} ` +
      `R=${metrics.recall.toFixed(2)} ` +
      `sourceR=${metrics.sourceRecall.toFixed(2)} ` +
      `(${metrics.sourceTruePositives}/${metrics.sourceGroundTruthCount} source)`,
    );

    // Token metrics placeholder — TODO wire scripts/bench/tokens.ts
    perPr.push({
      ...metrics,
      naiveTokens: 0,
      graphTokens: 0,
      reduction: 0,
    });
  }

  return {
    name: entry.name,
    prCount: perPr.length,
    avgF1: avg(perPr.map((p) => p.f1)),
    avgPrecision: avg(perPr.map((p) => p.precision)),
    avgRecall: avg(perPr.map((p) => p.recall)),
    avgSourceRecall: avg(perPr.map((p) => p.sourceRecall)),
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
  const passed = f1Pass && sourceRecallPass;

  let reason: string;
  if (passed) {
    reason = `F1 ${overallF1.toFixed(2)} ≥ ${GATE.f1Threshold} AND sourceRecall ${overallSourceRecall.toFixed(2)} ≥ ${GATE.sourceRecallThreshold}. Proceed to full bench.`;
  } else if (!f1Pass && !sourceRecallPass) {
    reason = `F1 ${overallF1.toFixed(2)} < ${GATE.f1Threshold} AND sourceRecall ${overallSourceRecall.toFixed(2)} < ${GATE.sourceRecallThreshold}. STOP — graph quality blocker. Do not publish.`;
  } else if (!f1Pass) {
    reason = `F1 ${overallF1.toFixed(2)} < ${GATE.f1Threshold}. Investigate before publishing.`;
  } else {
    reason = `sourceRecall ${overallSourceRecall.toFixed(2)} < ${GATE.sourceRecallThreshold}. STOP — missing indexable impact files. Do not publish.`;
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
