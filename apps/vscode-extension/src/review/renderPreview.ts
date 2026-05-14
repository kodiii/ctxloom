/**
 * Render a PreviewResult as Markdown. Mirrors the shape of the pr-bot's
 * summary comment (apps/pr-bot/src/review/renderSummary.ts) so the
 * in-editor preview reads the same as what reviewers will see on the
 * eventual PR.
 *
 * Intentionally NOT shared with the bot's renderer yet — the bot's
 * output has GitHub-specific concerns (idempotency markers, slash
 * commands, footer links) that don't apply here. A future refactor
 * could extract a shared markdown core if drift becomes a problem.
 */
import type { PreviewResult, RiskLevel } from './analyzeWorkingTree.js';

const RISK_EMOJI: Record<RiskLevel, string> = {
  low: '🟢',
  medium: '🟠',
  high: '🔴',
  critical: '🚨',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  critical: 'Critical risk',
};

export function renderPreview(result: PreviewResult): string {
  const { base, headSha, changedFiles, summary, blastRadius, topLevel, coupledNodes, isStub } =
    result;

  const headShaShort = headSha.slice(0, 7);
  const filesCount = changedFiles.length;
  const callersTotal = changedFiles.reduce((s, f) => s + f.importerCount, 0);

  // Header
  let out = '## 🧵 ctxloom preview\n\n';

  if (topLevel === null) {
    out += `_No files changed vs \`${base}\`._\n`;
    return out;
  }

  const emoji = RISK_EMOJI[topLevel];
  const label = RISK_LABELS[topLevel];
  out += `${emoji} **${label}** — \`${base}\` → \`${headShaShort}\`\n`;

  // One-liners
  out += `\n**Changed:** ${filesCount} file${filesCount !== 1 ? 's' : ''}, ${callersTotal} caller${callersTotal !== 1 ? 's' : ''} total`;
  out += `\n**Blast radius:** ${blastRadius} file${blastRadius !== 1 ? 's' : ''}`;
  out += `\n**Risk mix:** ${summary.critical} critical · ${summary.high} high · ${summary.medium} medium · ${summary.low} low`;

  if (isStub) {
    out +=
      '\n\n> ⚠️ Graph not available for this run — risk scores are based on file count only, not dependency analysis.';
  }

  // Risk breakdown — only render when there's something above low.
  // Mirrors the v1.2.5 pr-bot fix that suppresses the empty <details> block.
  const aboveLow = changedFiles
    .filter((f) => f.riskLevel !== 'low')
    .sort((a, b) => {
      const o = { critical: 0, high: 1, medium: 2, low: 3 } as const;
      return o[a.riskLevel] - o[b.riskLevel];
    });
  if (aboveLow.length > 0) {
    out += '\n\n### Risk breakdown\n\n';
    out += '| File | Risk | Callers | Test coverage |\n';
    out += '|------|------|---------|---------------|\n';
    for (const f of aboveLow.slice(0, 10)) {
      const cov = f.hasTestCoverage ? '✅' : '❌';
      out += `| \`${f.file}\` | ${RISK_EMOJI[f.riskLevel]} ${f.riskLevel} | ${f.importerCount} | ${cov} |\n`;
    }
    if (aboveLow.length > 10) {
      out += `\n…and ${aboveLow.length - 10} more`;
    }
  }

  // Historical coupling — surfaced from the git overlay when available.
  // Most useful preview signal: "you changed X, you should probably also
  // look at Y because they've historically co-changed."
  if (coupledNodes.length > 0) {
    const filteredCoupled = coupledNodes.filter((c) => c.confidence >= 0.5);
    if (filteredCoupled.length > 0) {
      out += '\n\n### Historical co-change signals\n\n';
      for (const c of filteredCoupled.slice(0, 8)) {
        const pct = Math.round(c.confidence * 100);
        out += `- \`${c.for}\` ↔ \`${c.node}\` (${pct}% confidence)\n`;
      }
    }
  }

  out +=
    '\n\n> This is the preview the ctxloom GitHub Action would post on the PR when you push this branch.';

  return out;
}
