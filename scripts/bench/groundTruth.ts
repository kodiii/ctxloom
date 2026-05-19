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

/**
 * Exported because metrics.ts uses it to compute source-file-only
 * recall (separate from total-file recall). Many real PRs include
 * docs / config / changelog entries in their ground truth that the
 * graph cannot possibly predict — counting those as false negatives
 * understates true graph quality.
 */
export function isSourceFile(filepath: string): boolean {
  const lastDot = filepath.lastIndexOf('.');
  if (lastDot < 0) return false;
  return SOURCE_EXTENSIONS.has(filepath.slice(lastDot).toLowerCase());
}

/**
 * Detect test files for entry-point selection.
 *
 * Test files are typically not imported by other code (the test
 * runner discovers them) — so blast radius from a test file
 * predicts an empty set. The methodology rule: prefer non-test
 * source as the entry point. A real reviewer starts from the
 * lib file being changed, not the test that verifies the change.
 *
 * PRs adding features almost always have more test-line changes
 * than source-line changes (good engineering — comprehensive
 * coverage). The naive "most-changed source file" picker
 * systematically targets the test as a result, producing
 * empty-set blast radius and tanked recall.
 *
 * Heuristic covers conventions across JS/TS/Python/Go/etc. False
 * positives are benign (we just don't pick them as entry). False
 * negatives mean we accidentally pick a test — the bug this fixes.
 */
function isTestFile(filepath: string): boolean {
  return (
    // Top-level test directories
    /^(test|tests|__tests__|spec)\//.test(filepath)
    // Nested test directories
    || /\/(test|tests|__tests__|spec)\//.test(filepath)
    // Filename conventions: foo.test.ts, foo.spec.js
    || /(?:\.|_)(test|spec)[.]/.test(filepath)
    // Python pytest convention: test_foo.py
    || /(?:^|\/)test_[a-zA-Z0-9_]+\.py$/.test(filepath)
    // Go convention: foo_test.go
    || /_test\.(go|rs)$/.test(filepath)
  );
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
 *  - entryPoint: most-changed non-test source file (alphabetical tie-break)
 *  - evalSha: the merge commit (post-PR state) — see types.ts for why
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
  // alphabetically for determinism.
  //
  // Two-tier preference:
  //   1. Non-test source files (lib/, src/, etc.) — what a reviewer
  //      would intuitively start from. Tests aren't imported by
  //      anything, so starting blast radius from a test predicts an
  //      empty set and tanks recall.
  //   2. Fall back to test files only if every source file in the
  //      PR is a test (rare — usually means a test-only PR, which
  //      our methodology gate may also reject downstream).
  //
  // Empirical: all three spike PRs (express#6903, express#6525,
  // fastapi#15030) picked a test file under the naive "most-changed
  // source" rule, because PRs adding features typically have more
  // test-line changes than source-line changes. The fix:
  // pre-partition by isTestFile() and pick from non-tests first.
  const sortByImpact = (files: GhPrFile[]): GhPrFile[] =>
    [...files].sort((a, b) => {
      const diff = (b.additions + b.deletions) - (a.additions + a.deletions);
      if (diff !== 0) return diff;
      return a.path.localeCompare(b.path);
    });

  const allSourceFiles = data.files.filter((f) => isSourceFile(f.path));
  const nonTestSource = allSourceFiles.filter((f) => !isTestFile(f.path));
  const sortedCandidates = nonTestSource.length > 0
    ? sortByImpact(nonTestSource)
    : sortByImpact(allSourceFiles);
  const entryPoint = sortedCandidates[0].path;

  // Index the merge commit (post-PR state), not baseRefOid (pre-PR).
  //
  // Pre-fix: baseRefOid = parent of PR head before merge → for PRs
  // that ADD new files (fastapi #15030 created fastapi/sse.py), the
  // entry-point file didn't exist in the graph and blast radius
  // collapsed to predicted=1.
  //
  // Post-fix: mergeCommit.oid = the commit that integrated the PR's
  // changes into main. A real reviewer reads THIS state — they have
  // the new code in front of them and ask "what does it touch?"
  //
  // Defensive fallback: GitHub returns mergeCommit=null for very old
  // PRs or rebases-without-merge-commit edge cases. We've already
  // gated on state==='MERGED' above so this is rare, but if it
  // happens, fall back to baseRefOid + warn rather than crash.
  let evalSha: string;
  if (data.mergeCommit?.oid) {
    evalSha = data.mergeCommit.oid;
  } else {
    // eslint-disable-next-line no-console -- bench output goes to stderr
    console.error(
      `  WARN: PR ${repo}#${prNumber} merged without a merge commit OID — ` +
      `using baseRefOid as fallback. Recall numbers may be artificially low ` +
      `for new-file PRs.`,
    );
    evalSha = data.baseRefOid;
  }

  return { prNumber, groundTruthFiles, entryPoint, evalSha };
}
