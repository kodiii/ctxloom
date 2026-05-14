/**
 * Per-file changed-line ranges, parsed from `git diff --unified=0`.
 *
 * Used by the gutter-decoration provider (C3) to know which lines in
 * each changed file are actually new on the RIGHT side of the diff —
 * so we decorate only the hunks the user changed, not the whole file.
 *
 * Why separate from analyzeWorkingTree:
 * - status bar (C2) only cares about the top-level risk, not lines
 * - the preview panel (C1) doesn't reference lines either
 * - the gutter is the only consumer that pays the cost of `git diff`
 *
 * Failure mode: any git error (missing base, bad workspace, binary
 * files in the diff) → that file gets an empty array. The decoration
 * layer treats empty as "no markers", which is correct.
 */
import { spawn } from 'node:child_process';

export interface LineRange {
  /** 1-indexed start line on the RIGHT side of the diff (post-change). */
  start: number;
  /** Inclusive count of lines in the hunk. Always >= 1. */
  count: number;
}

export interface FileLineRanges {
  /** Workspace-relative path. */
  file: string;
  /** Hunks added/modified on the new side. Empty for binary files / pure renames. */
  ranges: LineRange[];
}

/**
 * Parse a unified-diff body and yield `(file, [hunks])`. Visible for
 * unit tests — separate from the git subprocess so tests don't need
 * to spin up a real repo.
 *
 * Handles only what `git diff --unified=0` actually emits:
 *   diff --git a/<file> b/<file>
 *   @@ -X +A,B @@
 *
 * `B` defaults to 1 when omitted (single-line hunks). Pure deletions
 * (`@@ -X,Y +A,0 @@`) are dropped — no new-side lines to mark.
 */
export function parseUnifiedDiff(diff: string): FileLineRanges[] {
  const results: FileLineRanges[] = [];
  let current: FileLineRanges | null = null;

  for (const line of diff.split('\n')) {
    // New file header. Use the b/<path> form so renames and copies
    // both point at the post-change path.
    const fileMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (fileMatch) {
      if (current) results.push(current);
      current = { file: fileMatch[2], ranges: [] };
      continue;
    }
    if (current === null) continue;

    // Hunk header: `@@ -X[,Y] +A[,B] @@`. We only need the new-side
    // start (A) and count (B, default 1).
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkMatch) {
      const start = Number.parseInt(hunkMatch[1] ?? '', 10);
      const count = hunkMatch[2] === undefined ? 1 : Number.parseInt(hunkMatch[2], 10);
      if (Number.isFinite(start) && Number.isFinite(count) && count > 0 && start > 0) {
        current.ranges.push({ start, count });
      }
    }
  }
  if (current) results.push(current);
  return results;
}

function runGit(workspace: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd: workspace });
    let stdout = '';
    proc.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
    proc.on('close', (code) => resolve({ stdout, code: code ?? 1 }));
    proc.on('error', () => resolve({ stdout: '', code: 1 }));
  });
}

/**
 * Run `git diff --unified=0 base...HEAD` and return per-file line
 * ranges. Returns an empty array on any git failure — the caller can
 * still render decorations for the files it does know about (via
 * `analyzeWorkingTree`); we just skip them.
 */
export async function getChangedLineRanges(
  workspace: string,
  baseRef: string,
): Promise<FileLineRanges[]> {
  // `--unified=0` keeps the diff small (no context lines) — we only
  // need hunk headers. `--no-color` to be defensive against user
  // .gitconfig that forces color on subprocess git.
  const { stdout, code } = await runGit(workspace, [
    'diff',
    '--unified=0',
    '--no-color',
    `${baseRef}...HEAD`,
  ]);
  if (code !== 0) return [];
  return parseUnifiedDiff(stdout);
}
