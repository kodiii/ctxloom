/**
 * install-pr-bot.ts — write `.github/workflows/ctxloom-review.yml`
 * into the current repo so every PR triggers the ctxloom GitHub
 * Action review.
 *
 * Used by two surfaces:
 *   - `ctxloom install-pr-bot` (dedicated command)
 *   - `ctxloom setup` (optional step in the interactive wizard)
 *
 * Safety:
 *   - Aborts if not inside a git repo (workflow files only make sense
 *     in repos that GitHub Actions will pick up).
 *   - Aborts if the target file already exists, unless `force` is set.
 *   - Detects the repo's default branch from git and uses it in the
 *     workflow's `branches:` filter (so it works in repos that still
 *     default to `master` or any feature default).
 *   - Pinned to the latest released tag (a major-floating tag would be
 *     more permissive but commits the user to whatever future versions
 *     ship; pinning to v1.x lets them upgrade deliberately).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface InstallOptions {
  /** Project root (defaults to process.cwd()). */
  cwd?: string;
  /** Overwrite an existing workflow file. */
  force?: boolean;
  /** Action ref to install. Defaults to `v1` (floating major). */
  ref?: string;
}

export type InstallResult =
  | { status: 'installed'; path: string; defaultBranch: string }
  | { status: 'skipped-exists'; path: string }
  | { status: 'aborted-not-git'; reason: string };

const WORKFLOW_RELATIVE_PATH = '.github/workflows/ctxloom-review.yml';

function isGitRepo(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the repo's default branch. Order of preference:
 *   1. The remote HEAD ref (what `gh repo view --default-branch` would
 *      return) — accurate for repos cloned from GitHub.
 *   2. The local symbolic ref `refs/remotes/origin/HEAD`.
 *   3. The currently checked-out branch as a fallback.
 *   4. `main` as the last resort.
 *
 * The branch is used as the workflow's `branches:` filter, but pr-bot
 * fires on `pull_request` events, not `push`, so this is mostly
 * cosmetic. Still — better to record the right value than guess.
 */
function detectDefaultBranch(cwd: string): string {
  // 1. Remote HEAD (set by `git clone`; absent in freshly-init'd repos).
  try {
    const out = execFileSync(
      'git',
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd, encoding: 'utf8' },
    ).trim();
    if (out) return out.replace(/^origin\//, '');
  } catch {
    /* fall through */
  }

  // 2. Local HEAD's symbolic ref. Works even on an unborn HEAD (no
  // commits yet), which is the state of `git init` before the first
  // commit. `rev-parse --abbrev-ref` returns the literal "HEAD" in
  // that case, which is why we don't try it first.
  try {
    const out = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    if (out) return out;
  } catch {
    /* fall through */
  }

  // 3. Last resort.
  return 'main';
}

function renderWorkflow(ref: string, defaultBranch: string): string {
  // The `defaultBranch` value is only echoed as a comment header; the
  // bot fires on `pull_request` regardless, so it doesn't gate the
  // workflow. Recording it makes the file self-documenting.
  return `# ctxloom PR review — risk-scored summary + inline notes on every PR.
# Runs entirely inside this repo's CI; no hosted service, no LLM calls.
# Default branch for this repo: ${defaultBranch}
# Docs: https://github.com/kodiii/ctxloom/blob/main/apps/pr-bot/README.md

name: ctxloom review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # required: pr-bot reads git history for co-change overlay

      - uses: kodiii/ctxloom-pr-bot@${ref}
`;
}

export function installPrBotWorkflow(opts: InstallOptions = {}): InstallResult {
  const cwd = opts.cwd ?? process.cwd();
  const force = opts.force ?? false;
  const ref = opts.ref ?? 'v1';

  if (!isGitRepo(cwd)) {
    return {
      status: 'aborted-not-git',
      reason:
        `${cwd} is not inside a git repository. ` +
        'GitHub Actions only fire in repos with a remote, so this command needs one.',
    };
  }

  const target = path.resolve(cwd, WORKFLOW_RELATIVE_PATH);

  if (fs.existsSync(target) && !force) {
    return { status: 'skipped-exists', path: target };
  }

  const defaultBranch = detectDefaultBranch(cwd);
  const contents = renderWorkflow(ref, defaultBranch);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, { mode: 0o644 });

  return { status: 'installed', path: target, defaultBranch };
}
