/**
 * Markdown report writer. Emits to evaluate/reports/summary.md so
 * the output lives in version control (auto-refreshed by CI on
 * every release tag).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BenchReport, RepoReport } from './types.js';

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
    lines.push(`Threshold: F1 ≥ ${report.gate.f1Threshold} AND recall ≥ ${report.gate.recallThreshold}.`);
    lines.push('');
    lines.push(`Reason: ${report.gate.reason}`);
    lines.push('');
  }

  lines.push('## Overall');
  lines.push('');
  lines.push('| Repos | PRs | Avg F1 | Avg Precision | Avg Recall | Avg Reduction |');
  lines.push('|------:|----:|-------:|--------------:|-----------:|--------------:|');
  lines.push(
    `| ${report.overall.repoCount} ` +
    `| ${report.overall.prCount} ` +
    `| ${report.overall.avgF1.toFixed(2)} ` +
    `| ${report.overall.avgPrecision.toFixed(2)} ` +
    `| ${report.overall.avgRecall.toFixed(2)} ` +
    `| ${report.overall.avgReduction.toFixed(1)}× |`,
  );
  lines.push('');

  lines.push('## Per-repo');
  lines.push('');
  lines.push('| Repo | PRs | Avg F1 | Precision | Recall | Avg Reduction |');
  lines.push('|------|----:|-------:|----------:|-------:|--------------:|');
  for (const repo of report.repos) {
    lines.push(
      `| \`${repo.name}\` ` +
      `| ${repo.prCount} ` +
      `| ${repo.avgF1.toFixed(2)} ` +
      `| ${repo.avgPrecision.toFixed(2)} ` +
      `| ${repo.avgRecall.toFixed(2)} ` +
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
    lines.push('| PR | TP | FP | FN | Precision | Recall | F1 | Naive tok | Graph tok | Reduction |');
    lines.push('|---:|---:|---:|---:|----------:|-------:|---:|----------:|----------:|----------:|');
    for (const pr of repo.perPr) {
      lines.push(
        `| #${pr.prNumber} ` +
        `| ${pr.truePositives} ` +
        `| ${pr.falsePositives} ` +
        `| ${pr.falseNegatives} ` +
        `| ${pr.precision.toFixed(2)} ` +
        `| ${pr.recall.toFixed(2)} ` +
        `| ${pr.f1.toFixed(2)} ` +
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
