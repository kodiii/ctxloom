/**
 * Clone + checkout helpers for the bench corpus.
 *
 * Repos are cached at $BENCH_CACHE (defaults to /tmp/ctxloom-bench-corpus)
 * so re-runs don't pay the clone cost. Per-PR work uses `git worktree`
 * to checkout the parent commit into an isolated directory — avoids
 * blowing away the user's working tree if they're poking around in
 * the cached clones.
 *
 * Disk usage rough estimate (full corpus):
 *   - 6 repo clones (shallow): ~500MB
 *   - 18 worktrees @ avg 50MB: ~900MB
 *   - .ctxloom/ per worktree (graph + vector): ~100MB
 *   - TOTAL: ~2.5GB peak. Document this in the bench README.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BENCH_CACHE = process.env['CTXLOOM_BENCH_CACHE']
  ?? path.join(os.tmpdir(), 'ctxloom-bench-corpus');

fs.mkdirSync(BENCH_CACHE, { recursive: true });

/** Cache key for a repo. */
function repoSlug(repo: string): string {
  return repo.replace('/', '__');
}

/** Path to the cached repo clone. */
export function repoDir(repo: string): string {
  return path.join(BENCH_CACHE, repoSlug(repo));
}

/** Path to a per-PR worktree. */
export function worktreeDir(repo: string, prNumber: number): string {
  return path.join(BENCH_CACHE, `${repoSlug(repo)}__pr${prNumber}`);
}

/**
 * Clone the repo if not cached. Full clone (not --depth=1) because we
 * need to checkout arbitrary historical SHAs that depth=1 would have
 * pruned.
 */
export function ensureCloned(repo: string): string {
  const dir = repoDir(repo);
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  const url = `https://github.com/${repo}.git`;
  // eslint-disable-next-line no-console -- bench harness, stderr is fine
  console.error(`  Cloning ${repo} (full history)...`);
  execFileSync('git', ['clone', '--quiet', url, dir], { stdio: 'inherit' });
  return dir;
}

/**
 * Materialize a worktree at the given SHA. Idempotent — if the worktree
 * already exists, just verify its HEAD matches and return.
 */
export function ensureWorktree(repo: string, prNumber: number, sha: string): string {
  const main = ensureCloned(repo);
  const wt = worktreeDir(repo, prNumber);

  if (fs.existsSync(wt)) {
    const head = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (head === sha) return wt;
    // SHA mismatch — remove and re-create rather than reset (safer)
    execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', wt]);
  }

  execFileSync('git', ['-C', main, 'worktree', 'add', '--detach', wt, sha], { stdio: 'pipe' });
  return wt;
}

/** Tear down all worktrees for a repo (cleanup between bench runs). */
export function pruneWorktrees(repo: string): void {
  const main = ensureCloned(repo);
  execFileSync('git', ['-C', main, 'worktree', 'prune'], { stdio: 'pipe' });
}
