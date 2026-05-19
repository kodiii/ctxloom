/**
 * Drive ctxloom against a checked-out repo and extract the
 * blast-radius prediction for one entry-point file.
 *
 * Why we shell out instead of importing @ctxloom/core directly:
 *   - The bench is a *system* test of the published binary, not a
 *     unit test of internal modules. Running it via the CLI is what
 *     a real user does, so the bench numbers reflect real behavior.
 *   - Indexing creates side-effects (LanceDB, snapshots) per repo;
 *     keeping that in a child process makes cleanup trivial.
 *
 * Pre-conditions (caller must satisfy):
 *   - ctxloom is installed and on PATH (or CTXLOOM_BIN is set)
 *   - CTXLOOM_LICENSE_KEY is in the environment
 *   - The worktree at `repoPath` is checked out to the parent SHA
 *
 * What this does:
 *   1. Run `ctxloom index --root <repoPath>` to build the graph
 *   2. Call `ctx_blast_radius` via the CLI for the given entry-point
 *   3. Parse the JSON output; return the set of affected files
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Prediction } from './types.js';

const CTXLOOM_BIN = process.env['CTXLOOM_BIN'] ?? 'ctxloom';

/** Build the graph for a checked-out worktree. */
export function indexRepo(repoPath: string): void {
  execFileSync(CTXLOOM_BIN, ['index'], {
    cwd: repoPath,
    stdio: 'inherit',
    env: { ...process.env, CTXLOOM_ROOT: repoPath },
  });
}

/**
 * Call ctx_blast_radius via the CLI and return the predicted file set.
 *
 * The CLI command `ctxloom blast-radius <file> --json` is the surface
 * we shell into. If that's not implemented yet (it's the MCP tool's
 * CLI mirror), this function will need to drive the MCP server via
 * a JSON-RPC subprocess instead. Marked as TODO_CLI_SURFACE below.
 */
export function blastRadius(
  repoPath: string,
  entryPoint: string,
  prNumber: number,
): Prediction {
  // TODO_CLI_SURFACE: if `ctxloom blast-radius` isn't a CLI command,
  // we need to invoke the MCP server's `ctx_blast_radius` tool via
  // a child-process JSON-RPC harness. The shape of that wrapper is
  // pinned by scripts/bench/mcpClient.ts (not yet implemented —
  // build during spike if blastRadius CLI doesn't exist).
  const raw = execFileSync(
    CTXLOOM_BIN,
    ['blast-radius', entryPoint, '--json'],
    {
      cwd: repoPath,
      encoding: 'utf8',
      env: { ...process.env, CTXLOOM_ROOT: repoPath },
    },
  );

  interface BlastRadiusOutput {
    /** All files in the impact set (callers, dependents, tests). */
    affected: Array<{ file: string }>;
  }
  const parsed = JSON.parse(raw) as BlastRadiusOutput;

  // Normalize paths to repo-relative (matches ground-truth format from gh).
  const predictedFiles = parsed.affected.map((entry) =>
    path.relative(repoPath, path.resolve(repoPath, entry.file)),
  );

  return { prNumber, predictedFiles };
}
