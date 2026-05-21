/**
 * Markdown report writer. Emits to evaluate/reports/summary.md so
 * the output lives in version control (auto-refreshed by CI on
 * every release tag).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BenchReport, RepoReport } from './types.js';

/**
 * Render a coverage cell. -1 is the "not applicable" marker (e.g.
 * import coverage on pure-Go corpora that exclusively use module-path
 * imports) — emit "n/a" so reviewers don't confuse it with a real
 * score of 0.0 or 1.0.
 */
function fmtCoverage(value: number): string {
  if (value < 0) return 'n/a';
  return value.toFixed(2);
}

export function renderMarkdown(report: BenchReport): string {
  const lines: string[] = [];

  lines.push(`# ctxloom benchmark`);
  lines.push('');
  lines.push(`Generated ${report.generatedAt} on commit ${report.ctxloomSha}.`);
  lines.push(`Stage: **${report.stage}**.`);
  lines.push('');
  lines.push('Reproduce locally:');
  lines.push('');
  lines.push('```');
  lines.push(`npm run bench:${report.stage}`);
  lines.push('```');
  lines.push('');

  if (report.gate) {
    lines.push('## Spike gate');
    lines.push('');
    const verdict = report.gate.passed ? '**PASSED**' : '**FAILED**';
    lines.push(`Gate result: ${verdict}`);
    lines.push('');
    lines.push(`Threshold: F1 ≥ ${report.gate.f1Threshold} OR sourceRecall ≥ ${report.gate.sourceRecallThreshold}.`);
    lines.push('');
    lines.push(`Reason: ${report.gate.reason}`);
    lines.push('');
  }

  lines.push('## Overall');
  lines.push('');
  lines.push('| Repos | PRs | Avg F1 | Avg Precision | Avg Recall | Avg Source Recall | Avg Graph Reachability | Avg Symbol Coverage | Avg Import Coverage | Avg Reduction |');
  lines.push('|------:|----:|-------:|--------------:|-----------:|------------------:|----------------------:|-------------------:|-------------------:|--------------:|');
  lines.push(
    `| ${report.overall.repoCount} ` +
    `| ${report.overall.prCount} ` +
    `| ${report.overall.avgF1.toFixed(2)} ` +
    `| ${report.overall.avgPrecision.toFixed(2)} ` +
    `| ${report.overall.avgRecall.toFixed(2)} ` +
    `| ${report.overall.avgSourceRecall.toFixed(2)} ` +
    `| ${report.overall.avgGraphReachability.toFixed(2)} ` +
    `| ${report.overall.avgSymbolCoverage.toFixed(2)} ` +
    `| ${fmtCoverage(report.overall.avgImportCoverage)} ` +
    `| ${report.overall.avgReduction.toFixed(1)}× |`,
  );
  lines.push('');
  lines.push(
    '> **Source Recall** = recall computed against only the indexable (source-file) ' +
    'subset of each PR\'s ground truth — measures the prediction algorithm.',
  );
  lines.push('');
  lines.push(
    '> **Graph Reachability** = fraction of source-file ground truth that is structurally ' +
    'reachable from the entry point via BFS over the import graph (depth ≤ 4, forward + ' +
    'reverse). Measures the **graph** independent of the prediction algorithm — separates ' +
    '"graph completeness" from "algorithm quality". If sourceRecall ≪ graphReachability the ' +
    'algorithm is too conservative; if graphReachability itself is low the graph is missing edges.',
  );
  lines.push('');
  lines.push(
    '> **Symbol Coverage** = fraction of AST-declared function/class/method/interface symbols ' +
    'present in `graph.symbolIndex` with correct file attribution. Measured DIRECTLY against ' +
    'AST ground truth — no prediction algorithm or external oracle in between. The primary ' +
    'test of "absurd accuracy across all project files": if symbolCoverage ≥ 0.95 the graph ' +
    'genuinely knows where 95%+ of declared symbols live; downstream tools (`ctx_get_definition`, ' +
    '`find_callers`, refactor preview) inherit that accuracy.',
  );
  lines.push('');
  lines.push(
    '> **Import Coverage** = fraction of AST-found intra-repo (relative) import statements ' +
    'that resulted in a graph forwardEdge. Direct measure of the import resolver\'s correctness, ' +
    'independent of any prediction algorithm. Per-extension breakdown isolates language-specific ' +
    'resolver gaps — e.g. if `gin` shows .go imports at 0.30 coverage while JS/TS/Py are at 1.00, ' +
    'the Go-resolver path is dropping edges. Diagnoses precisely WHERE in the graph layer a low ' +
    'graphReachability number originates.',
  );
  lines.push('');

  lines.push('## Per-repo');
  lines.push('');
  lines.push('| Repo | PRs | Avg F1 | Precision | Recall | Source Recall | Graph Reach. | Symbol Cov. | Import Cov. | Avg Reduction |');
  lines.push('|------|----:|-------:|----------:|-------:|--------------:|-------------:|------------:|------------:|--------------:|');
  for (const repo of report.repos) {
    lines.push(
      `| \`${repo.name}\` ` +
      `| ${repo.prCount} ` +
      `| ${repo.avgF1.toFixed(2)} ` +
      `| ${repo.avgPrecision.toFixed(2)} ` +
      `| ${repo.avgRecall.toFixed(2)} ` +
      `| ${repo.avgSourceRecall.toFixed(2)} ` +
      `| ${repo.avgGraphReachability.toFixed(2)} ` +
      `| ${repo.avgSymbolCoverage.toFixed(2)} ` +
      `| ${fmtCoverage(repo.avgImportCoverage)} ` +
      `| ${repo.avgReduction.toFixed(1)}× |`,
    );
  }
  lines.push('');

  lines.push('## Per-PR (full data)');
  lines.push('');
  lines.push('<details><summary>Click to expand</summary>');
  lines.push('');
  for (const repo of report.repos) {
    lines.push(`### ${repo.name}`);
    lines.push('');
    lines.push('| PR | TP | FP | FN | Precision | Recall | F1 | Src TP/GT | Src Recall | Graph Reach. | Naive tok | Graph tok | Reduction |');
    lines.push('|---:|---:|---:|---:|----------:|-------:|---:|----------:|-----------:|-------------:|----------:|----------:|----------:|');
    for (const pr of repo.perPr) {
      lines.push(
        `| #${pr.prNumber} ` +
        `| ${pr.truePositives} ` +
        `| ${pr.falsePositives} ` +
        `| ${pr.falseNegatives} ` +
        `| ${pr.precision.toFixed(2)} ` +
        `| ${pr.recall.toFixed(2)} ` +
        `| ${pr.f1.toFixed(2)} ` +
        `| ${pr.sourceTruePositives}/${pr.sourceGroundTruthCount} ` +
        `| ${pr.sourceRecall.toFixed(2)} ` +
        `| ${pr.graphReachability.toFixed(2)} ` +
        `| ${pr.naiveTokens.toLocaleString()} ` +
        `| ${pr.graphTokens.toLocaleString()} ` +
        `| ${pr.reduction.toFixed(1)}× |`,
      );
    }
    lines.push('');
  }
  lines.push('</details>');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('See [methodology](../methodology.md) for how these numbers are computed and [limitations](../limitations.md) for known weaknesses.');

  return lines.join('\n');
}

export function writeReport(report: BenchReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'summary.md');
  fs.writeFileSync(file, renderMarkdown(report) + '\n', 'utf8');
  return file;
}
