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
 * Returns the union of FOUR signals:
 *   1. The entry point itself (always a TP if it's in ground truth)
 *   2. Direct importers (1-hop inbound)
 *   3. Direct importees (1-hop outbound — files the entry depends on)
 *   4. Symbol callers (files calling any symbol exported by the entry)
 *
 * Depth=1 calibration history: depth=3 over-predicted on hub files
 * (P=0.01-0.10). Switching to depth=1 collapsed recall to 0.07 because
 * many PR files reach the entry only transitively (or through the
 * package main, not directly). The augmentation with importees +
 * symbol callers brings recall back without sacrificing precision.
 *
 * Empirical pattern that motivates each signal:
 *
 *   - Express #6525 touches 14 files. Only 1 directly imports
 *     lib/response.js (lib/express.js — the package entry). So
 *     `directImporters` finds 1 of 13 source TPs. But:
 *     * lib/utils.js (which response.js IMPORTS) is in the PR ✓
 *       captured by `directImportees`
 *     * test/res.* files don't `require('../lib/response')` — they
 *       `require('..')` (package entry) and call `res.send()`.
 *       captured by `symbolCallers` via call-graph lookup of `send`.
 *
 *   - Fastapi #15030 adds a NEW file fastapi/sse.py. It has 0 inbound
 *     importers (nothing imports it yet — it's new). But it imports
 *     several existing modules, captured by `directImportees`.
 *
 * Historical coupling deliberately excluded — methodology measures
 * static graph quality, not git overlay quality. See methodology.md.
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
    includeImportees: true,
    includeSymbolCallers: true,
  });

  // Union of four signals: seed + direct importers + direct importees
  // + symbol callers. `transitiveImporters` is empty at depth=1 (we
  // keep the spread for shape-stability if depth ever changes).
  const predicted = new Set<string>([
    ...report.seedFiles,
    ...report.directImporters,
    ...report.transitiveImporters,
    ...report.directImportees,
    ...report.symbolCallers,
  ]);

  return {
    prNumber,
    predictedFiles: Array.from(predicted),
  };
}
