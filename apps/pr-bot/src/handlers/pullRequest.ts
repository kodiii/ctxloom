import type { Context } from 'probot';
import { parse as parseYaml } from 'yaml';
import { DependencyGraph } from '@ctxloom/core';
import { buildReview } from '../review/buildReview.js';
import { suggestReviewers } from '../review/reviewerSuggest.js';
import { findBotComment, buildCommentBody } from '../review/idempotency.js';
import { renderInline } from '../review/renderInline.js';
import { publishCheck } from '../checks/publishCheck.js';
import { parseRepoConfig } from '../config.js';
import type { RepoConfig } from '../config.js';
import type { Octokit } from '@octokit/core';

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

async function loadRepoConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<RepoConfig> {
  try {
    const response = await (octokit as unknown as {
      repos: {
        getContent: (params: {
          owner: string;
          repo: string;
          path: string;
        }) => Promise<{ data: { type: string; content: string } }>;
      };
    }).repos.getContent({
      owner,
      repo,
      path: '.ctxloom.yml',
    });

    const { data } = response;
    if (data.type !== 'file') return parseRepoConfig(undefined);

    const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
    const parsed: unknown = parseYaml(decoded);
    return parseRepoConfig(parsed);
  } catch {
    return parseRepoConfig(undefined);
  }
}

// ---------------------------------------------------------------------------
// Helper: list changed file paths from the PR
// ---------------------------------------------------------------------------

async function listChangedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<string[]> {
  const response = await (octokit as unknown as {
    pulls: {
      listFiles: (params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
      }) => Promise<{ data: Array<{ filename: string }> }>;
    };
  }).pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  return response.data.map(f => f.filename);
}

// ---------------------------------------------------------------------------
// Helper: upsert summary comment
// ---------------------------------------------------------------------------

async function upsertSummaryComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  headSha: string,
  body: string,
): Promise<void> {
  const listResponse = await (octokit as unknown as {
    issues: {
      listComments: (params: {
        owner: string;
        repo: string;
        issue_number: number;
      }) => Promise<{ data: Array<{ id: number; body: string }> }>;
    };
  }).issues.listComments({ owner, repo, issue_number: issueNumber });

  const existing = findBotComment(listResponse.data, headSha);

  if (existing) {
    await (octokit as unknown as {
      issues: {
        updateComment: (params: {
          owner: string;
          repo: string;
          comment_id: number;
          body: string;
        }) => Promise<unknown>;
      };
    }).issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
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
}

// ---------------------------------------------------------------------------
// Helper: post inline review comments
// ---------------------------------------------------------------------------

async function postInlineComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
  review: Awaited<ReturnType<typeof buildReview>>,
  maxInline: number,
): Promise<void> {
  const comments = review.changedFiles
    .map(f => renderInline(f, review))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .slice(0, maxInline);

  if (comments.length === 0) return;

  await (octokit as unknown as {
    pulls: {
      createReview: (params: {
        owner: string;
        repo: string;
        pull_number: number;
        commit_id: string;
        event: string;
        comments: Array<{
          path: string;
          line: number;
          side: string;
          body: string;
        }>;
      }) => Promise<unknown>;
    };
  }).pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: headSha,
    event: 'COMMENT',
    comments,
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function onPullRequest(context: Context<'pull_request'>): Promise<void> {
  const { owner, repo } = context.repo();
  const pr = context.payload.pull_request;
  const prNumber = pr.number;
  const headSha: string = pr.head.sha;
  const baseSha: string = pr.base.sha;

  try {
    const config = await loadRepoConfig(context.octokit as unknown as Octokit, owner, repo);
    const changedFiles = await listChangedFiles(
      context.octokit as unknown as Octokit,
      owner,
      repo,
      prNumber,
    );

    // Use an empty graph stub — real graph building (Task 4 ensureGraph) is a future enhancement
    const graph = new DependencyGraph();

    const prInfo = {
      owner,
      repo,
      number: prNumber,
      headSha,
      baseSha,
    };

    const rawReview = await buildReview({
      graph,
      overlay: undefined,
      changedFiles,
      pr: prInfo,
      config,
    });

    const review = {
      ...rawReview,
      suggestedReviewers: suggestReviewers({
        filesTouched: changedFiles,
        overlay: undefined,
        recentApprovers: [],
      }),
    };

    const graphEmpty = graph.allFiles().length === 0;
    let commentBody = buildCommentBody(review);
    if (graphEmpty) {
      commentBody +=
        '\n\n> ⚠️ Graph not yet available for this repo — risk scores are based on file count only, not dependency analysis.';
    }

    await upsertSummaryComment(
      context.octokit as unknown as Octokit,
      owner,
      repo,
      prNumber,
      headSha,
      commentBody,
    );

    if (config.inline_comments) {
      await postInlineComments(
        context.octokit as unknown as Octokit,
        owner,
        repo,
        prNumber,
        headSha,
        review,
        config.max_inline_per_pr,
      );
    }

    if (config.check_run) {
      await publishCheck(
        context.octokit as unknown as Octokit,
        { owner, name: repo },
        review,
      );
    }
  } catch (err) {
    await (context.octokit as unknown as {
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
      issue_number: prNumber,
      body: '🧵 ctxloom: analysis failed — see logs.',
    });
  }
}
