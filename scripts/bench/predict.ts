/**
 * Drive ctxloom against a checked-out repo and extract the blast-radius
 * prediction for one entry-point file.
 *
 * Strategy: shell to `ctxloom index` to build the graph snapshot (this
 * is the same thing a real user does), then hydrate the snapshot via
 * @ctxloom/core's DependencyGraph.loadSnapshotOnly() and call
 * getImpactRadius() directly. The blast-radius algorithm is the same
 * one ctx_blast_radius dispatches to, so the bench numbers reflect
 * what a real MCP client would see — minus the JSON-RPC layer, which
 * is a transport detail that doesn't affect F1.
 *
 * Why not shell to `ctxloom blast-radius`: it's not a CLI subcommand
 * (only an MCP tool). Spawning the MCP server, doing the handshake,
 * and parsing tool-call XML responses per PR would add ~30 seconds
 * of process startup per measurement with zero accuracy gain.
 *
 * Pre-conditions (caller must satisfy):
 *   - ctxloom is installed and on PATH (or CTXLOOM_BIN env is set)
 *   - License is activated locally (state in ~/.ctxloom/ — no env
 *     var needed for local runs; CTXLOOM_LICENSE_KEY only for CI)
 *   - The worktree at `repoPath` is checked out to the parent SHA
 */
import { execFileSync } from 'node:child_process';
import { DependencyGraph } from '@ctxloom/core';
import { getImpactRadius } from '@ctxloom/core';
import type { Prediction } from './types.js';

const CTXLOOM_BIN = process.env['CTXLOOM_BIN'] ?? 'ctxloom';

/**
 * Build the graph for a checked-out worktree.
 *
 * Shells to the published binary because that's what a real user
 * runs, and because the indexer's side effects (LanceDB, snapshots
 * in .ctxloom/) need to settle on disk for the subsequent
 * loadSnapshotOnly() call to find them.
 */
export function indexRepo(repoPath: string): void {
  execFileSync(CTXLOOM_BIN, ['index'], {
    cwd: repoPath,
    stdio: 'inherit',
    env: { ...process.env, CTXLOOM_ROOT: repoPath },
  });
}

/**
 * Compute blast radius from the entry point against the indexed graph.
 *
 * Returns the union of:
 *   - the entry point itself (always a TP if it's in ground truth)
 *   - direct importers (1-hop) only
 *
 * Depth=1 calibration: was depth=3 in the original spike, which on a
 * hub file like lib/response.js (express) or fastapi/routing.py
 * (fastapi) reached 25-66% of the codebase and crashed precision to
 * 0.01-0.10. Empirical pattern from the v1.6.0 spike:
 *
 *   - depth=3 express #6525: predicted 103 of 155 files, P=0.10
 *   - depth=3 fastapi #15022: predicted 652 of 2464 files, P=0.01
 *
 * Depth=3 over-predicts on hub files because everything is reachable
 * from a hub at depth 3 in a connected codebase. Depth=1 keeps the
 * prediction tight to files that DIRECTLY import the seed — the set
 * a reviewer would intuitively inspect first.
 *
 * Recall trade-off: we lose 2-hop and 3-hop importers from the
 * prediction set. Tests that reach the seed through index.js →
 * lib/express.js → lib/seed.js (the express CommonJS chain) drop
 * out. So recall on small repos like express may dip slightly; on
 * larger codebases like fastapi the noise reduction should
 * dominate.
 *
 * Excludes the historical-coupling section because that depends on
 * git overlay quality, which the bench corpus doesn't reliably have
 * at every merge SHA. Published methodology pins this as a
 * deliberate choice — bench measures static call-graph blast radius,
 * not coupling overlay.
 */
export async function blastRadius(
  repoPath: string,
  entryPoint: string,
  prNumber: number,
): Promise<Prediction> {
  const graph = new DependencyGraph();
  const loaded = await graph.loadSnapshotOnly(repoPath);
  if (!loaded) {
    throw new Error(
      `No graph snapshot found at ${repoPath}/.ctxloom/graph-snapshot.json. ` +
      `Did indexRepo() run successfully?`,
    );
  }

  const report = getImpactRadius({
    graph,
    changedFiles: [entryPoint],
    depth: 1,
  });

  // Union: the entry point + direct importers only. With depth=1
  // above, transitiveImporters is empty by definition; we leave the
  // spread for shape-stability in case future calibration revisits
  // depth (debug-friendly — easier to see the shape change in diffs).
  const predicted = new Set<string>([
    ...report.seedFiles,
    ...report.directImporters,
    ...report.transitiveImporters,
  ]);

  return {
    prNumber,
    predictedFiles: Array.from(predicted),
  };
}
