import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onPullRequest } from '../src/handlers/pullRequest.js';
import { onIssueComment } from '../src/handlers/issueComment.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { RepoConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

type MockFn = ReturnType<typeof vi.fn>;

interface MockOctokit {
  issues: {
    listComments: MockFn;
    createComment: MockFn;
    updateComment: MockFn;
  };
  pulls: {
    listFiles: MockFn;
    get: MockFn;
  };
  checks: {
    create: MockFn;
  };
  repos: {
    getContent: MockFn;
    getCollaboratorPermissionLevel: MockFn;
  };
}

function makeMockOctokit(overrides: Partial<MockOctokit> = {}): MockOctokit {
  return {
    issues: {
      listComments: vi.fn().mockResolvedValue({ data: [] }),
      createComment: vi.fn().mockResolvedValue({ data: { id: 100 } }),
      updateComment: vi.fn().mockResolvedValue({ data: { id: 100 } }),
      ...overrides.issues,
    },
    pulls: {
      listFiles: vi.fn().mockResolvedValue({
        data: [
          { filename: 'src/auth.ts', status: 'modified' },
          { filename: 'src/utils.ts', status: 'modified' },
        ],
      }),
      get: vi.fn().mockResolvedValue({
        data: {
          number: 1,
          head: { sha: 'abc123' },
          base: { sha: 'base000' },
          changed_files: 2,
        },
      }),
      ...overrides.pulls,
    },
    checks: {
      create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
      ...overrides.checks,
    },
    repos: {
      getContent: vi.fn().mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 })),
      getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({ data: { permission: 'write' } }),
      ...overrides.repos,
    },
  };
}

function makePrContext(
  octokit: MockOctokit,
  prNumber = 1,
  headSha = 'abc123',
  configOverride?: Partial<RepoConfig>,
) {
  // Simulate loadRepoConfig returning DEFAULT_CONFIG (getContent throws 404)
  // by ensuring repos.getContent is the 404 mock (default in makeMockOctokit)

  // If a config override is desired, we mock getContent to return it via yaml
  if (configOverride) {
    const yaml = Object.entries({ ...DEFAULT_CONFIG, ...configOverride })
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join('\n');
    octokit.repos.getContent = vi.fn().mockResolvedValue({
      data: { type: 'file', content: Buffer.from(yaml).toString('base64') },
    });
  }

  return {
    octokit,
    payload: {
      pull_request: {
        number: prNumber,
        head: { sha: headSha },
        base: { sha: 'base000' },
        changed_files: 2,
      },
      repository: {
        owner: { login: 'acme' },
        name: 'api',
      },
    },
    repo: () => ({ owner: 'acme', repo: 'api' }),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as Parameters<typeof onPullRequest>[0];
}

function makeIssueCommentContext(body: string, octokit?: MockOctokit, isPR = false) {
  const mock = octokit ?? makeMockOctokit();
  const issue: Record<string, unknown> = { number: 1 };
  if (isPR) {
    issue.pull_request = { url: 'https://api.github.com/repos/acme/api/pulls/1' };
  }
  return {
    octokit: mock,
    payload: {
      comment: { body, user: { login: 'collab' } },
      issue,
      repository: {
        owner: { login: 'acme' },
        name: 'api',
      },
    },
    repo: () => ({ owner: 'acme', repo: 'api' }),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as Parameters<typeof onIssueComment>[0];
}

// ---------------------------------------------------------------------------
// Handler tests: onPullRequest
// ---------------------------------------------------------------------------

describe('onPullRequest', () => {
  let octokit: MockOctokit;

  beforeEach(() => {
    octokit = makeMockOctokit();
  });

  it('creates a summary comment (POST) on pull_request.opened with 2 changed files', async () => {
    const context = makePrContext(octokit, 1, 'sha-open');
    await onPullRequest(context);

    expect(octokit.issues.createComment).toHaveBeenCalledOnce();
    expect(octokit.issues.updateComment).not.toHaveBeenCalled();

    const call = (octokit.issues.createComment as MockFn).mock.calls[0][0];
    expect(call.owner).toBe('acme');
    expect(call.repo).toBe('api');
    expect(call.issue_number).toBe(1);
    expect(typeof call.body).toBe('string');
    expect(call.body.length).toBeGreaterThan(0);
  });

  it('updates the existing comment (PATCH) on synchronize when bot comment already exists', async () => {
    // Simulate an existing bot comment from first call
    const existingBody = 'previous review\n<!-- ctxloom:review:old-sha -->';
    octokit.issues.listComments = vi.fn().mockResolvedValue({
      data: [{ id: 99, body: existingBody }],
    });

    const context = makePrContext(octokit, 1, 'sha-sync');
    await onPullRequest(context);

    expect(octokit.issues.updateComment).toHaveBeenCalledOnce();
    expect(octokit.issues.createComment).not.toHaveBeenCalled();

    const call = (octokit.issues.updateComment as MockFn).mock.calls[0][0];
    expect(call.comment_id).toBe(99);
  });

  it('does NOT post inline review comments when config.inline_comments is false', async () => {
    const createReviewSpy = vi.fn().mockResolvedValue({ data: {} });
    (octokit as unknown as Record<string, unknown>).pulls = {
      ...(octokit.pulls as object),
      listFiles: octokit.pulls.listFiles,
      createReview: createReviewSpy,
    };

    const context = makePrContext(octokit, 1, 'sha-noinline', { inline_comments: false });
    await onPullRequest(context);

    expect(createReviewSpy).not.toHaveBeenCalled();
  });

  it('catches any error and posts a minimal fallback comment — does not re-throw', async () => {
    // Make listFiles throw to force the catch path
    octokit.pulls.listFiles = vi.fn().mockRejectedValue(new Error('GitHub API unavailable'));

    const context = makePrContext(octokit, 1, 'sha-error');

    // Must not throw
    await expect(onPullRequest(context)).resolves.toBeUndefined();

    // Must post fallback comment
    expect(octokit.issues.createComment).toHaveBeenCalledOnce();
    const call = (octokit.issues.createComment as MockFn).mock.calls[0][0];
    expect(call.body).toContain('ctxloom');
  });

  it('creates a check run when config.check_run is true', async () => {
    const context = makePrContext(octokit, 1, 'sha-check', { check_run: true });
    await onPullRequest(context);

    expect(octokit.checks.create).toHaveBeenCalledOnce();
    const call = (octokit.checks.create as MockFn).mock.calls[0][0];
    expect(call.name).toBe('ctxloom/risk');
  });
});

// ---------------------------------------------------------------------------
// Handler tests: onIssueComment (slash commands — Task 10)
// ---------------------------------------------------------------------------

describe('onIssueComment', () => {
  it('replies to /ctxloom explain <path>', async () => {
    const octokit = makeMockOctokit();
    const context = makeIssueCommentContext('/ctxloom explain src/auth.ts', octokit);

    await onIssueComment(context);

    expect(octokit.issues.createComment).toHaveBeenCalledOnce();
    const call = (octokit.issues.createComment as MockFn).mock.calls[0][0];
    expect(call.body).toContain('explain');
    expect(call.body).toContain('src/auth.ts');
  });

  it('replies to /ctxloom ignore', async () => {
    const octokit = makeMockOctokit();
    const context = makeIssueCommentContext('/ctxloom ignore', octokit);

    await onIssueComment(context);

    expect(octokit.issues.createComment).toHaveBeenCalledOnce();
    const call = (octokit.issues.createComment as MockFn).mock.calls[0][0];
    expect(call.body).toContain('ignore');
  });

  it('replies to /ctxloom refresh', async () => {
    const octokit = makeMockOctokit();
    // For refresh we need pulls.listFiles and issues.listComments for the re-trigger
    const context = makeIssueCommentContext('/ctxloom refresh', octokit, true);

    await onIssueComment(context);

    expect(octokit.issues.createComment).toHaveBeenCalled();
    const firstCall = (octokit.issues.createComment as MockFn).mock.calls[0][0];
    expect(firstCall.body).toContain('re-running');
  });

  it('does NOT reply to non-matching comments', async () => {
    const octokit = makeMockOctokit();
    const context = makeIssueCommentContext('Just a regular comment', octokit);

    await onIssueComment(context);

    expect(octokit.issues.createComment).not.toHaveBeenCalled();
  });

  it('does NOT reply to comments that almost match but are malformed', async () => {
    const octokit = makeMockOctokit();
    const context = makeIssueCommentContext('/ctxloom unknown-command', octokit);

    await onIssueComment(context);

    expect(octokit.issues.createComment).not.toHaveBeenCalled();
  });
});
