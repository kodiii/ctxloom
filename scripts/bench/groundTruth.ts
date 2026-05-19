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
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt: string | null;
}

/** Extensions we treat as "source" — used to enforce the methodology rule
 *  that PRs touch ≥ 2 source files. Markdown/JSON/yaml are configuration
 *  or docs and don't exercise the import graph. */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue',
  '.py', '.rs', '.go', '.java', '.cs', '.rb', '.kt', '.kts',
  '.swift', '.php', '.dart', '.c', '.cpp', '.h',
]);

function isSourceFile(filepath: string): boolean {
  const lastDot = filepath.lastIndexOf('.');
  if (lastDot < 0) return false;
  return SOURCE_EXTENSIONS.has(filepath.slice(lastDot).toLowerCase());
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
      '--json', 'files,baseRefOid,mergeCommit,state,mergedAt',
    ],
    { encoding: 'utf8' },
  );
  const data = JSON.parse(raw) as GhPrView;

  // Methodology gate: refuse to evaluate against PRs that violate
  // the selection rules. Failing fast here beats silently producing
  // junk numbers (which is what happened on the first spike run
  // when I'd guessed PR numbers without checking).
  if (data.state !== 'MERGED' || data.mergedAt === null) {
    throw new Error(
      `PR ${repo}#${prNumber} is ${data.state} (not MERGED). ` +
      `Methodology rule violated. Replace this PR in scripts/bench/corpus.ts.`,
    );
  }

  const groundTruthFiles = data.files
    .map((f) => f.path)
    .filter((p) => !isBinary(p));

  if (groundTruthFiles.length === 0) {
    throw new Error(
      `PR ${repo}#${prNumber} has no non-binary files in diff. ` +
      `Excluded from corpus or fix the PR selection.`,
    );
  }

  const sourceFiles = groundTruthFiles.filter(isSourceFile);
  if (sourceFiles.length < 2) {
    throw new Error(
      `PR ${repo}#${prNumber} touches only ${sourceFiles.length} source file(s). ` +
      `Methodology rule (≥2 source files) violated. ` +
      `Files: ${groundTruthFiles.join(', ')}. ` +
      `Replace this PR in scripts/bench/corpus.ts.`,
    );
  }

  // Entry-point = source file with most lines changed; ties broken
  // alphabetically for determinism. Restricting to source files (not
  // just non-binary) means a PR with one large History.md change and
  // a small lib/foo.js change picks lib/foo.js — which is what an
  // agent reviewer would intuitively start from.
  const sortedSourceByImpact = [...data.files]
    .filter((f) => isSourceFile(f.path))
    .sort((a, b) => {
      const diff = (b.additions + b.deletions) - (a.additions + a.deletions);
      if (diff !== 0) return diff;
      return a.path.localeCompare(b.path);
    });
  const entryPoint = sortedSourceByImpact[0].path;

  // baseRefOid is the parent of the PR head before merge — the
  // "pre-PR state" we want to index.
  const parentSha = data.baseRefOid;

  return { prNumber, groundTruthFiles, entryPoint, parentSha };
}
