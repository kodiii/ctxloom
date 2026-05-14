/**
 * Pure review-runner — no Probot, no webhook context, no global state.
 *
 * Takes an Octokit instance plus PR coordinates, runs the ctxloom
 * analysis, and posts the resulting summary comment / inline comments /
 * check run. Designed so the Action entrypoint (src/action.ts) and any
 * future tests can drive it with a mock Octokit.
 *
 * The Probot-flavored `handlers/pullRequest.ts` predecessor lived here
 * historically; this file is its successor with the framework wrapper
 * stripped off.
 */
import { parse as parseYaml } from 'yaml';
import {
  DependencyGraph,
  captureError,
  GitOverlayStore,
} from '@ctxloom/core';
import type { Octokit } from '@octokit/core';

import { buildReview } from './review/buildReview.js';
import { suggestReviewers } from './review/reviewerSuggest.js';
import { findBotComment, buildCommentBody } from './review/idempotency.js';
import { renderInline } from './review/renderInline.js';
import { publishCheck } from './checks/publishCheck.js';
import { parseRepoConfig, type RepoConfig } from './config.js';

export interface ReviewInput {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  /** Absolute path to the checked-out working tree (Actions: `$GITHUB_WORKSPACE`). */
  workspace?: string;
  /** Console-compatible logger. Action runner passes a thin wrapper around process.stdout. */
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

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
    }).repos.getContent({ owner, repo, path: '.ctxloom.yml' });

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
  }).pulls.listFiles({ owner, repo, pull_number: pullNumber, per_page: 100 });

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
        comments: Array<{ path: string; line: number; side: string; body: string }>;
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
// Build a real graph + overlay against the checked-out workspace.
// In Actions this is `$GITHUB_WORKSPACE`. When unset (or empty) we fall
// back to the previous Probot behavior — an empty graph stub with the
// summary comment annotated to explain why scores are file-count only.
// ---------------------------------------------------------------------------

async function buildLocalGraph(
  workspace: string | undefined,
  log: ReviewInput['log'],
): Promise<{ graph: DependencyGraph; overlay: GitOverlayStore | undefined; isStub: boolean }> {
  if (!workspace || workspace.trim() === '') {
    return { graph: new DependencyGraph(), overlay: undefined, isStub: true };
  }

  try {
    const graph = new DependencyGraph();
    await graph.buildFromDirectory(workspace);
    let overlay: GitOverlayStore | undefined;
    try {
      overlay = new GitOverlayStore(workspace);
      await overlay.refresh();
    } catch (err) {
      log.warn('git overlay unavailable, proceeding without:', err);
      overlay = undefined;
    }
    return { graph, overlay, isStub: false };
  } catch (err) {
    log.warn('graph build failed, falling back to stub:', err);
    return { graph: new DependencyGraph(), overlay: undefined, isStub: true };
  }
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export async function runReview(input: ReviewInput): Promise<void> {
  const { octokit, owner, repo, prNumber, headSha, baseSha, workspace, log } = input;

  try {
    const config = await loadRepoConfig(octokit, owner, repo);
    const changedFiles = await listChangedFiles(octokit, owner, repo, prNumber);

    const { graph, overlay, isStub } = await buildLocalGraph(workspace, log);

    const rawReview = await buildReview({
      graph,
      overlay,
      changedFiles,
      pr: { owner, repo, number: prNumber, headSha, baseSha },
      config,
    });

    const review = {
      ...rawReview,
      suggestedReviewers: suggestReviewers({
        filesTouched: changedFiles,
        overlay,
        recentApprovers: [],
      }),
    };

    let commentBody = buildCommentBody(review);
    if (isStub) {
      commentBody +=
        '\n\n> ⚠️ Graph not available for this run — risk scores are based on file count only, not dependency analysis.';
    }

    await upsertSummaryComment(octokit, owner, repo, prNumber, headSha, commentBody);

    if (config.inline_comments) {
      await postInlineComments(
        octokit,
        owner,
        repo,
        prNumber,
        headSha,
        review,
        config.max_inline_per_pr,
      );
    }

    if (config.check_run) {
      await publishCheck(octokit, { owner, name: repo }, review);
    }
  } catch (err) {
    captureError(err, {
      component: 'pr-bot',
      handler: 'pull_request',
      owner,
      repo,
      pr_number: prNumber,
    });
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
      issue_number: prNumber,
      body: '🧵 ctxloom: analysis failed — see logs.',
    });
    throw err;
  }
}
