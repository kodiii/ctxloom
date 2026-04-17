import type { Context } from 'probot';
import type { Octokit } from '@octokit/core';
import { onPullRequest } from './pullRequest.js';

const SLASH_RE = /^\/ctxloom\s+(explain|ignore|refresh)(?:\s+(.+))?$/;

type SlashCommand = 'explain' | 'ignore' | 'refresh';

async function replyToComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await (octokit as unknown as {
    issues: {
      createComment: (params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }) => Promise<unknown>;
    };
  }).issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

export async function onIssueComment(
  context: Context<'issue_comment.created'>,
): Promise<void> {
  const commentBody: string = context.payload.comment.body;
  const match = SLASH_RE.exec(commentBody.trim());

  if (!match) return;

  const command = match[1] as SlashCommand;
  const arg = match[2] ?? '';
  const { owner, repo } = context.repo();
  const issueNumber: number = context.payload.issue.number;
  const octokit = context.octokit as unknown as Octokit;

  if (command === 'explain') {
    await replyToComment(
      octokit,
      owner,
      repo,
      issueNumber,
      `ctxloom: would explain \`${arg}\` — full context coming in v2.`,
    );
    return;
  }

  if (command === 'ignore') {
    await replyToComment(
      octokit,
      owner,
      repo,
      issueNumber,
      'ctxloom: will ignore this PR from now on.',
    );
    return;
  }

  if (command === 'refresh') {
    await replyToComment(
      octokit,
      owner,
      repo,
      issueNumber,
      'ctxloom: re-running analysis…',
    );

    // Fetch the actual PR to get real SHAs before re-triggering analysis.
    const { data: pr } = await (context.octokit as unknown as {
      pulls: {
        get: (params: {
          owner: string;
          repo: string;
          pull_number: number;
        }) => Promise<{
          data: {
            head: { sha: string };
            base: { sha: string };
            number: number;
            changed_files: number;
          };
        }>;
      };
    }).pulls.get({ owner, repo, pull_number: issueNumber });

    const prContext = {
      octokit: context.octokit,
      payload: {
        pull_request: pr,
        repository: context.payload.repository,
      },
      repo: context.repo.bind(context),
      log: context.log,
    } as unknown as Parameters<typeof onPullRequest>[0];

    await onPullRequest(prContext);
  }
}
