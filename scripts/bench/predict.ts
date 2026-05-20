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
import { DependencyGraph, GitOverlayStore } from '@ctxloom/core';
import { getImpactRadius } from '@ctxloom/core';
import { logger } from '../../packages/core/src/utils/logger.js';
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
 * Returns the union of FIVE signals:
 *   1. The entry point itself (always a TP if it's in ground truth)
 *   2. Direct importers (1-hop inbound)
 *   3. Direct importees (1-hop outbound — files the entry depends on)
 *   4. Symbol callers (files calling any symbol exported by the entry)
 *   5. Historical coupling (files that co-changed with entry in git)
 *
 * Depth=1 calibration history: depth=3 over-predicted on hub files
 * (P=0.01-0.10). Switching to depth=1 collapsed recall to 0.07 because
 * many PR files reach the entry only transitively. The augmentation
 * with importees + symbol callers brings recall back without
 * sacrificing precision.
 *
 * Empirical pattern that motivates each signal:
 *
 *   - Express #6525 touches 14 files. Only 1 directly imports
 *     lib/response.js. The other 13 either reach it via importees
 *     (`lib/utils.js`) or via call-graph (`res.send()` callers).
 *
 *   - Fastapi #15030 adds a NEW file `fastapi/sse.py`. It has 0
 *     inbound importers — but several outbound importees catch the
 *     related util files. Captured by `directImportees`.
 *
 *   - Fastapi #15022 modifies `routing.py` to support streaming.
 *     The PR's `test_stream_*.py` files DON'T import APIRouter —
 *     they import `FastAPI` / `StreamingResponse` and test the
 *     behavior indirectly. Static import + call graph cannot connect
 *     them; only git co-change can: those tests were authored in the
 *     same PR sequence as the routing.py modifications, so the
 *     GitOverlayStore co-change index links them. Captured by
 *     `historicalCoupling`.
 *
 * Historical coupling is OPT-IN per PR — the overlay must be built
 * for the worktree. We do this once per worktree (rebuild() is the
 * idempotent path) before evaluating any PR for that repo. Cost is
 * ~1-2 seconds for the spike corpus repos, scaled by git history.
 */
export async function blastRadius(
  repoPath: string,
  entryPoint: string,
  prNumber: number,
  overlay?: GitOverlayStore,
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
    overlay,
    changedFiles: [entryPoint],
    depth: 1,
    includeImportees: true,
    includeSymbolCallers: true,
  });

  // Union of five signals: seed + direct importers + direct importees
  // + symbol callers + historical coupling. `transitiveImporters` is
  // empty at depth=1; spread is kept for shape-stability.
  const predicted = new Set<string>([
    ...report.seedFiles,
    ...report.directImporters,
    ...report.transitiveImporters,
    ...report.directImportees,
    ...report.symbolCallers,
    ...report.historicalCoupling.map((h) => h.node),
  ]);

  return {
    prNumber,
    predictedFiles: Array.from(predicted),
  };
}

/**
 * Build a GitOverlayStore for the worktree. Idempotent: if a saved
 * snapshot exists, it's loaded; otherwise we mine the git history.
 *
 * Caller is responsible for invoking this once per repo (not per PR)
 * because the overlay is per-worktree, not per-checkout-SHA. The PR's
 * indexRepo() call has already checked out the merge SHA, so this
 * builds the overlay against that SHA's history.
 *
 * Returns `undefined` and logs a warning on failure so the bench can
 * proceed without coupling data — historicalCoupling will simply be
 * empty for that PR.
 */
export async function buildOverlay(repoPath: string): Promise<GitOverlayStore | undefined> {
  try {
    const overlay = new GitOverlayStore(repoPath);
    const loaded = await overlay.loadSnapshot();
    if (!loaded) {
      await overlay.rebuild();
    }
    return overlay;
  } catch (err) {
    logger.warn('Bench: GitOverlayStore build failed, proceeding without co-change signal', {
      repo: repoPath,
      detail: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
