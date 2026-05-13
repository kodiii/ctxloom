import type { ReviewPayload } from './types.js';
import type { ChangedFile } from '@ctxloom/core';

const CHAR_LIMIT = 60_000;
const RISK_BREAKDOWN_ROWS = 5;

const RISK_EMOJI: Record<'low' | 'medium' | 'high' | 'critical', string> = {
  low: '🟢',
  medium: '🟠',
  high: '🔴',
  critical: '🚨',
};

const RISK_LABELS: Record<'low' | 'medium' | 'high' | 'critical', string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  critical: 'Critical risk',
};

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function buildRiskTable(files: readonly ChangedFile[], maxRows: number): string {
  const sorted = [...files]
    .filter(f => f.riskLevel !== 'low')
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.riskLevel] - order[b.riskLevel];
    });

  const rows = sorted.slice(0, maxRows);
  const extra = sorted.length - rows.length;

  const header = '| File | Risk | Callers | Test coverage |\n|------|------|---------|---------------|\n';
  const body = rows
    .map(f => {
      const cov = f.hasTestCoverage ? '✅' : '❌';
      return `| \`${f.file}\` | ${RISK_EMOJI[f.riskLevel]} ${f.riskLevel} | ${f.importerCount} | ${cov} |`;
    })
    .join('\n');

  const suffix = extra > 0 ? `\n\n…and ${extra} more` : '';
  return header + body + suffix;
}

function buildAffectedFlows(payload: ReviewPayload): string {
  if (payload.impact.totalImpacted === 0) return '';

  const direct = payload.impact.directImporters.slice(0, 5);
  const more = payload.impact.totalImpacted - direct.length;
  const list = direct.map(f => `- \`${f}\``).join('\n');
  const suffix = more > 0 ? `\n- …and ${more} more` : '';

  return `\n\n### Affected flows\n\n${list}${suffix}`;
}

function buildReviewerLine(payload: ReviewPayload): string {
  if (payload.suggestedReviewers.length === 0) return '';
  const logins = payload.suggestedReviewers.map(r => `@${r.login}`).join(', ');
  return `\n**Suggested reviewers:** ${logins}`;
}

export function renderSummary(payload: ReviewPayload): string {
  const { riskLabel, riskScore, changedFiles, impact, pr } = payload;
  const emoji = RISK_EMOJI[riskLabel];
  const label = RISK_LABELS[riskLabel];
  const score = formatPercent(riskScore);

  const changedCount = changedFiles.length;
  const functionCount = changedFiles.reduce((sum, f) => sum + f.importerCount, 0);
  const blastRadius = impact.totalImpacted;

  const header = `## 🧵 ctxloom review\n\n${emoji} **${label}** (score: ${score})\n`;
  const oneLiner = `\n**Changed:** ${changedCount} file${changedCount !== 1 ? 's' : ''}, ${functionCount} caller${functionCount !== 1 ? 's' : ''} total`;
  const blastLine = `\n**Blast radius:** ${blastRadius} file${blastRadius !== 1 ? 's' : ''}`;
  const reviewerLine = buildReviewerLine(payload);
  const affectedFlows = buildAffectedFlows(payload);

  const table = buildRiskTable(changedFiles, RISK_BREAKDOWN_ROWS);
  const breakdown = table
    ? `\n\n<details>\n<summary>Risk breakdown</summary>\n\n${table}\n</details>`
    : '';

  const footer =
    '\n\n> Run `/ctxloom explain <file>` to expand | `/ctxloom ignore` to dismiss | `/ctxloom refresh` to re-run';
  const marker = `\n<!-- ctxloom:review:${pr.headSha} -->`;

  let output =
    header +
    oneLiner +
    blastLine +
    reviewerLine +
    affectedFlows +
    breakdown +
    footer +
    marker;

  if (output.length > CHAR_LIMIT) {
    const tableCompact = buildRiskTable(changedFiles, 3);
    const breakdownCompact = tableCompact
      ? `\n\n<details>\n<summary>Risk breakdown (top 3)</summary>\n\n${tableCompact}\n</details>`
      : '';

    output =
      header +
      oneLiner +
      blastLine +
      reviewerLine +
      affectedFlows +
      breakdownCompact +
      footer +
      marker;
  }

  return output;
}
