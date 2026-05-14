/**
 * ctxloom-action — GitHub Action entrypoint.
 *
 * This script is the executable surface of the ctxloom PR review.
 * Distributed as a JavaScript Action: users reference
 *   `uses: kodiii/ctxloom/apps/pr-bot@v1`
 * in their `.github/workflows/*.yml`, and GitHub runs this single
 * bundled file (`dist/index.js`) inside an `actions/checkout`'d repo.
 *
 * Inputs (set via `with:` in the workflow, surfaced as `INPUT_*` env vars):
 *   - github-token   GitHub token (default: ${{ secrets.GITHUB_TOKEN }})
 *
 * Required environment (provided automatically by the Actions runner):
 *   - GITHUB_EVENT_PATH    Path to the JSON event payload
 *   - GITHUB_EVENT_NAME    Should be `pull_request` (we skip anything else)
 *   - GITHUB_REPOSITORY    owner/name
 *   - GITHUB_WORKSPACE     Working tree (output of actions/checkout)
 *
 * Exit codes:
 *   0  Review posted (or no-op because event was not a PR)
 *   1  Hard failure — see logs
 */
import fs from 'node:fs';
import { Octokit } from '@octokit/rest';

import { runReview } from './runReview.js';

interface PullRequestEvent {
  action?: string;
  pull_request?: {
    number: number;
    head: { sha: string };
    base: { sha: string };
  };
  repository?: {
    owner: { login: string };
    name: string;
  };
}

function readInput(name: string): string {
  // GitHub Actions normalizes `with:` keys to uppercase env vars prefixed
  // INPUT_ and replaces spaces/hyphens with underscores.
  const envName = `INPUT_${name.toUpperCase().replace(/-/g, '_')}`;
  return process.env[envName] ?? '';
}

async function main(): Promise<void> {
  const eventName = process.env['GITHUB_EVENT_NAME'];
  if (eventName !== 'pull_request') {
    console.log(
      `[ctxloom-action] event was '${eventName}', not 'pull_request' — nothing to do.`,
    );
    return;
  }

  const eventPath = process.env['GITHUB_EVENT_PATH'];
  if (!eventPath || !fs.existsSync(eventPath)) {
    throw new Error(
      `GITHUB_EVENT_PATH is unset or missing (got '${eventPath}'). ` +
        'This Action must be run from a GitHub Actions workflow triggered by `pull_request`.',
    );
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as PullRequestEvent;

  // Only act on opened / synchronize / reopened. Closed PRs and label
  // events are no-ops; we don't want to repost on every label flip.
  const allowedActions = new Set(['opened', 'synchronize', 'reopened']);
  if (event.action && !allowedActions.has(event.action)) {
    console.log(
      `[ctxloom-action] pull_request action='${event.action}' — skipping (only opened/synchronize/reopened are handled).`,
    );
    return;
  }

  const pr = event.pull_request;
  const repository = event.repository;
  if (!pr || !repository) {
    throw new Error('Event payload missing pull_request or repository fields.');
  }

  const token = readInput('github-token') || process.env['GITHUB_TOKEN'] || '';
  if (!token) {
    throw new Error(
      'No github-token input provided and GITHUB_TOKEN env var is empty. ' +
        'Add `permissions: { pull-requests: write, contents: read, checks: write }` to your workflow.',
    );
  }

  const workspace = process.env['GITHUB_WORKSPACE'] || process.cwd();

  const octokit = new Octokit({ auth: token });

  await runReview({
    octokit: octokit as unknown as Parameters<typeof runReview>[0]['octokit'],
    owner: repository.owner.login,
    repo: repository.name,
    prNumber: pr.number,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    workspace,
    log: console,
  });

  console.log('[ctxloom-action] review complete.');
}

main().catch(err => {
  console.error('[ctxloom-action] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
