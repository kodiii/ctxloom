import type { ReviewPayload } from './types.js';
import type { ChangedFile } from '@ctxloom/core';
import {
  computeSuggestedSteps,
  renderSuggestedStepsSection,
} from './suggestedNextSteps.js';

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

  // No above-low files → no table at all. Returning '' lets the caller
  // suppress the surrounding `<details>` block so we don't render an
  // empty headers-only table on benign PRs (cosmetic gap seen on PR #94).
  if (sorted.length === 0) return '';

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

/**
 * Render the ready-to-paste deep-review prompt that a local Claude
 * Code session can run to produce a multi-agent specialist review
 * (security / architecture / testing / performance) on top of what
 * this bot already computed.
 *
 * Design intent — the prompt encodes everything the bot already
 * computed (risk band, blast radius, file-level coverage gaps,
 * suggested reviewers) so the four specialists don't re-do the
 * structural pre-fetch work. They jump straight into per-domain
 * analysis with the structural context as ground truth.
 *
 * Kept inside a collapsible `<details>` block so it doesn't dominate
 * the bot comment for low-risk PRs that probably don't need a deep
 * review at all.
 *
 * @public Exported for unit testing.
 */
export function buildDeepReviewPrompt(payload: ReviewPayload): string {
  const { pr, riskLabel, riskScore, changedFiles, impact, suggestedReviewers } = payload;
  const changedCount = changedFiles.length;
  const blastRadius = impact.totalImpacted;

  // Top-risk files with coverage gap surfaced explicitly so the
  // testing specialist starts where it matters most.
  const topRiskFiles = [...changedFiles]
    .filter(f => f.riskLevel !== 'low')
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.riskLevel] - order[b.riskLevel];
    })
    .slice(0, 5);

  const topRiskLines = topRiskFiles.length === 0
    ? '  (no above-low-risk files — focus on net-new behavior in the diff)'
    : topRiskFiles
        .map(f => `  - \`${f.file}\` — ${f.riskLevel} (${f.importerCount} callers, ${f.hasTestCoverage ? '✅ test coverage' : '❌ NO test coverage'})`)
        .join('\n');

  const reviewerHint = suggestedReviewers.length > 0
    ? `\n- Domain owners: ${suggestedReviewers.map(r => `@${r.login}`).join(', ')} — defer judgment-call findings to them`
    : '';

  // The dispatch instruction is intentionally explicit about
  // parallelism + the consolidated-comment requirement. Without
  // those, individual sessions tend to either sequentialize the
  // specialists (slow) or fan out without consolidating (noisy).
  const prompt = `Review PR #${pr.number} in ${pr.owner}/${pr.repo} using the multi-agent dogfood flow.

Pre-fetched context (the pr-bot CI already computed this — don't redo it):
- Risk: ${RISK_EMOJI[riskLabel]} ${RISK_LABELS[riskLabel]} (score: ${formatPercent(riskScore)})
- Changed: ${changedCount} file${changedCount !== 1 ? 's' : ''}, blast radius ${blastRadius} file${blastRadius !== 1 ? 's' : ''}
- HEAD SHA: ${pr.headSha}
- Top-risk files with coverage status:
${topRiskLines}${reviewerHint}

Dispatch all 4 specialist subagents in PARALLEL (single Task message
with 4 tool_use blocks): security, architecture, testing, performance.
Use ctxloom MCP tools (T0 structural first, T1 skeleton, T2 definition,
T3 full file only as last resort). Apply tier discipline strictly.

Post a single consolidated review comment on PR #${pr.number} with:
- Verdict (approve / approve_with_nits / needs_changes) + severity totals
- Token-budget reality check table (per-specialist + total)
- Tier distribution bullet list
- Findings grouped by severity (Medium first, then Low, then Info)
- A machine-readable telemetry HTML-comment block at the end`;

  return prompt;
}

/**
 * Wrap the deep-review prompt in a `<details>` block + code fence so
 * users can copy-paste it cleanly. The summary line is phrased as the
 * call-to-action; the body is the prompt itself.
 */
function buildDeepReviewSection(payload: ReviewPayload): string {
  const prompt = buildDeepReviewPrompt(payload);
  return (
    '\n\n<details>\n' +
    '<summary>🤖 Run a deep specialist review in your local Claude Code</summary>\n\n' +
    "The risk overlay above is the bot's structural pass. For a deeper review " +
    '(security boundaries, architecture, test coverage gaps, perf hot paths), ' +
    'paste this prompt into your local Claude Code session — it encodes the ' +
    "context the bot already computed so the specialists don't re-do that work.\n\n" +
    '```\n' +
    prompt +
    '\n```\n' +
    '</details>'
  );
}

export function renderSummary(payload: ReviewPayload): string {
  const { riskLabel, riskScore, changedFiles, impact, pr } = payload;
  const emoji = RISK_EMOJI[riskLabel];
  const label = RISK_LABELS[riskLabel];

  const changedCount = changedFiles.length;
  const functionCount = changedFiles.reduce((sum, f) => sum + f.importerCount, 0);
  const blastRadius = impact.totalImpacted;

  // The score is only shown when it adds signal — i.e. above-low risk.
  // For a `low` label, the band itself communicates everything; the
  // hardcoded `low → 20%` was misleading (no, a clean PR isn't "20%
  // risky"). For medium/high/critical the percentage helps reviewers
  // distinguish "just barely high" from "deeply critical".
  const scoreSuffix =
    riskLabel === 'low' ? '' : ` (score: ${formatPercent(riskScore)})`;

  const header = `## 🧵 ctxloom review\n\n${emoji} **${label}**${scoreSuffix}\n`;
  const oneLiner = `\n**Changed:** ${changedCount} file${changedCount !== 1 ? 's' : ''}, ${functionCount} caller${functionCount !== 1 ? 's' : ''} total`;
  const blastLine = `\n**Blast radius:** ${blastRadius} file${blastRadius !== 1 ? 's' : ''}`;
  const reviewerLine = buildReviewerLine(payload);
  const affectedFlows = buildAffectedFlows(payload);

  const table = buildRiskTable(changedFiles, RISK_BREAKDOWN_ROWS);
  const breakdown = table
    ? `\n\n<details>\n<summary>Risk breakdown</summary>\n\n${table}\n</details>`
    : '';

  // Self-service deep review: every PR (even low-risk ones — the
  // user might still want a second opinion) gets a copy-paste prompt
  // for a local Claude Code dogfood. Cheap to emit, gated behind a
  // <details> block so it doesn't dominate the comment.
  const deepReview = buildDeepReviewSection(payload);

  // Phase 4c — risk-tiered next-step suggestions using the prepackaged
  // skills from Phase 3. The bot already did the structural pre-fetch
  // (risk + impact); this section turns that data into actionable
  // slash commands the PR author can paste into Claude Code.
  const suggestedSteps = renderSuggestedStepsSection(computeSuggestedSteps(payload));

  // The footer used to advertise `/ctxloom explain|ignore|refresh`
  // slash commands. Those were Probot-handler features and were
  // deleted when pr-bot pivoted to a fire-and-forget GitHub Action
  // (PR #83) — Actions don't listen to issue_comment events. The
  // footer now points users at the docs so they know what the bot
  // does and where to file feedback.
  const footer =
    '\n\n> 🧵 [ctxloom pr-bot](https://github.com/kodiii/ctxloom/blob/main/apps/pr-bot/README.md) · ' +
    '[Configure](https://github.com/kodiii/ctxloom/blob/main/apps/pr-bot/README.md#configure-ctxloomyml) · ' +
    '[Report a problem](https://github.com/kodiii/ctxloom/issues/new?labels=pr-bot)';
  const marker = `\n<!-- ctxloom:review:${pr.headSha} -->`;

  let output =
    header +
    oneLiner +
    blastLine +
    reviewerLine +
    affectedFlows +
    breakdown +
    deepReview +
    suggestedSteps +
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
      deepReview +
      suggestedSteps +
      footer +
      marker;
  }

  return output;
}
