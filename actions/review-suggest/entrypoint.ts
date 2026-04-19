import { execSync } from 'node:child_process';
import path from 'node:path';
import { GitOverlayStore } from '../../src/git/GitOverlayStore.js';
import { scoreReviewers } from '../../src/review/ReviewerScorer.js';
import { AuthorResolver } from '../../src/review/AuthorResolver.js';
import { loadReviewConfig } from '../../src/review/loadConfig.js';
import type { CandidateActivity } from '../../src/review/types.js';

const MARKER = '<!-- ctxloom:review-suggest -->';

async function run(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const prNumber = process.env.PR_NUMBER;
  const sha = process.env.GITHUB_SHA ?? '';
  const root = process.cwd();
  const ctxloomDir = path.join(root, '.ctxloom');
  const max = parseInt(process.env.INPUT_MAX ?? '3', 10);

  if (!token || !prNumber) {
    console.log('[ctxloom-action] Missing GITHUB_TOKEN or PR_NUMBER — skipping.');
    return;
  }

  const [owner, repoName] = repo.split('/') as [string, string];

  // Get changed files from GitHub API
  const filesRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}/files?per_page=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  );
  const filesData = await filesRes.json() as Array<{ filename: string }>;
  const changedFiles = filesData.map(f => f.filename);

  if (changedFiles.length === 0) {
    console.log('[ctxloom-action] No changed files.');
    return;
  }

  // Get PR author email
  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  );
  const prData = await prRes.json() as { user: { email?: string; login: string } };
  const prAuthorEmail = prData.user.email ?? '';

  // Load indexes — constructor takes (repoRoot: string, opts?: OverlayBootstrapOptions)
  // loadSnapshot() returns Promise<boolean>: false if sidecar not found, true on success
  const store = new GitOverlayStore(root);
  const loaded = await store.loadSnapshot();

  if (!loaded) {
    console.log('[ctxloom-action] No git overlay found — running index...');
    execSync('npx ctxloom index', { cwd: root, stdio: 'inherit' });
    await store.loadSnapshot();
  }

  const config = await loadReviewConfig(root);
  config.defaults = { ...config.defaults, max };

  const activity = buildActivity(store);
  const resolver = new AuthorResolver(ctxloomDir);
  await resolver.load();

  const result = scoreReviewers(
    changedFiles,
    store.ownership,
    store.coChange,
    activity,
    prAuthorEmail,
    config,
  );

  // Build comment body
  const rows = result.suggestions.map((s, i) => {
    const handle = resolver.resolve(s.breakdown.email);
    const displayName = (typeof handle === 'string') ? `@${handle}` : s.breakdown.email;
    return `| ${i + 1} | ${displayName} | ${s.breakdown.total.toFixed(2)} | ${s.reason} |`;
  }).join('\n');

  const warningLines = result.warnings
    .map(w => {
      if (w.busFactor <= 2) return `> ⚠ Bus factor is ${w.busFactor} for \`${w.pattern}\`. Consider pairing a second reviewer.`;
      return `> ⚠ Top owner last touched \`${w.pattern}\` ${w.topOwnerStalenessDays}d ago. Ownership may be stale.`;
    })
    .join('\n');

  const body = [
    MARKER,
    '### 🧵 Suggested reviewers',
    '',
    '| # | Reviewer | Score | Why |',
    '|---|----------|-------|-----|',
    rows || '| — | No suggestions | — | All candidates filtered |',
    '',
    warningLines,
    '',
    `_Based on git history as of \`${sha.slice(0, 7)}\`. Powered by [ctxloom](https://ctxloom.com)._`,
  ].join('\n');

  // Find existing sticky comment or post new one
  const commentsRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments?per_page=100`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
  );
  const comments = await commentsRes.json() as Array<{ id: number; body: string }>;
  const existing = comments.find(c => c.body.includes(MARKER));

  if (existing) {
    await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/issues/comments/${existing.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      },
    );
    console.log('[ctxloom-action] Updated existing suggestion comment.');
  } else {
    await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      },
    );
    console.log('[ctxloom-action] Posted new suggestion comment.');
  }
}

function buildActivity(store: GitOverlayStore): CandidateActivity[] {
  const lastTouchMap = new Map<string, number>();
  for (const file of store.ownership.allNodes()) {
    const ownerStats = store.ownership.statsFor(file);
    const churnStats = store.churn.statsFor(file);
    if (!ownerStats || !churnStats) continue;
    for (const owner of ownerStats.owners) {
      const existing = lastTouchMap.get(owner.email) ?? 0;
      if (churnStats.lastTouch > existing) {
        lastTouchMap.set(owner.email, churnStats.lastTouch);
      }
    }
  }
  return Array.from(lastTouchMap.entries()).map(([email, lastCommitTimestamp]) => ({
    email,
    lastCommitTimestamp,
  }));
}

run().catch(err => {
  console.error('[ctxloom-action] Error:', err);
  process.exit(1);
});
