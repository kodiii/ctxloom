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
 *   - the entry point itself (technically also "predicted to be affected")
 *   - direct importers (1-hop)
 *   - transitive importers (up to depth=3)
 *
 * Excludes the historical-coupling section because that depends on git
 * overlay, which the bench corpus doesn't reliably have at every parent
 * SHA. The published methodology pins this as a deliberate choice — the
 * bench measures the static call-graph blast radius, not the historical
 * coupling overlay.
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
    depth: 3,
  });

  // Union: the entry point + everything blast-radius identified.
  // De-dupe in case the graph somehow lists the seed file as its own
  // importer (it shouldn't, but defensive).
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
