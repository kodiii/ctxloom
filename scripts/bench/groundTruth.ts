/**
 * Fetch ground truth for a PR via `gh pr view --json files`.
 *
 * The set of files in the merged PR diff is our oracle — what the
 * human author touched together to make the change work. Binary files
 * are filtered (token counts undefined for them) but otherwise we
 * keep everything: added, modified, removed.
 *
 * Why `gh` not GitHub API directly: gh handles auth (uses the local
 * token), pagination, and rate-limit retries automatically. In CI,
 * `GITHUB_TOKEN` is wired into gh transparently.
 */
import { execFileSync } from 'node:child_process';
import type { GroundTruth } from './types.js';

interface GhPrFile {
  path: string;
  additions: number;
  deletions: number;
}

interface GhPrView {
  files: GhPrFile[];
  baseRefOid: string;
  /** Parent commit of the PR head — what we'd checkout to simulate "before". */
  mergeCommit: { oid: string } | null;
}

/** Filter heuristics matching the methodology doc. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.bz2',
  '.woff', '.woff2', '.ttf', '.otf',
  '.mp3', '.mp4', '.mov', '.wav',
]);

function isBinary(filepath: string): boolean {
  const lastDot = filepath.lastIndexOf('.');
  if (lastDot < 0) return false;
  return BINARY_EXTENSIONS.has(filepath.slice(lastDot).toLowerCase());
}

/**
 * Fetch ground truth for one PR.
 *
 * Returns:
 *  - groundTruthFiles: paths the PR actually changed (binary-filtered)
 *  - entryPoint: most-changed file (TIE-BREAKER: alphabetical for determinism)
 *  - parentSha: what to checkout for "pre-PR state"
 */
export function fetchGroundTruth(repo: string, prNumber: number): GroundTruth {
  const raw = execFileSync(
    'gh',
    [
      'pr', 'view', String(prNumber),
      '--repo', repo,
      '--json', 'files,baseRefOid,mergeCommit',
    ],
    { encoding: 'utf8' },
  );
  const data = JSON.parse(raw) as GhPrView;

  const groundTruthFiles = data.files
    .map((f) => f.path)
    .filter((p) => !isBinary(p));

  if (groundTruthFiles.length === 0) {
    throw new Error(
      `PR ${repo}#${prNumber} has no non-binary files in diff. ` +
      `Excluded from corpus or fix the PR selection.`,
    );
  }

  // Entry-point = max(additions + deletions); ties broken alphabetically
  // so the bench is fully deterministic.
  const sortedByImpact = [...data.files]
    .filter((f) => !isBinary(f.path))
    .sort((a, b) => {
      const diff = (b.additions + b.deletions) - (a.additions + a.deletions);
      if (diff !== 0) return diff;
      return a.path.localeCompare(b.path);
    });
  const entryPoint = sortedByImpact[0].path;

  // baseRefOid is the parent of the PR head before merge — the
  // "pre-PR state" we want to index.
  const parentSha = data.baseRefOid;

  return { prNumber, groundTruthFiles, entryPoint, parentSha };
}
