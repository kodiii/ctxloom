import type { Octokit } from '@octokit/core';
import type { ReviewPayload } from '../review/types.js';

function buildSummary(payload: ReviewPayload): string {
  const sorted = [...payload.changedFiles].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.riskLevel] ?? 3) - (order[b.riskLevel] ?? 3);
  });

  const top3 = sorted.slice(0, 3);

  return top3
    .map(f => `- \`${f.file}\` — ${f.riskLevel} (${f.importerCount} caller${f.importerCount !== 1 ? 's' : ''})`)
    .join('\n');
}

export async function publishCheck(
  octokit: Octokit,
  repo: { owner: string; name: string },
  payload: ReviewPayload,
): Promise<void> {
  const { riskScore, riskLabel, config, pr } = payload;

  const conclusion: 'success' | 'failure' =
    riskScore < config.risk_threshold ? 'success' : 'failure';

  const scorePercent = Math.round(riskScore * 100);
  const title = `Risk: ${riskLabel} (${scorePercent}/100)`;
  const summary = buildSummary(payload);

  await (octokit as unknown as {
    checks: {
      create: (params: {
        owner: string;
        repo: string;
        name: string;
        head_sha: string;
        status: string;
        conclusion: string;
        output: { title: string; summary: string };
      }) => Promise<unknown>;
    };
  }).checks.create({
    owner: repo.owner,
    repo: repo.name,
    name: 'ctxloom/risk',
    head_sha: pr.headSha,
    status: 'completed',
    conclusion,
    output: {
      title,
      summary,
    },
  });
}
