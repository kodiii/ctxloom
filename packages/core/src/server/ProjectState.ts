/**
 * ProjectState — per-project lazy singletons.
 *
 * Mirrors the module-level singletons that lived in src/server.ts in
 * v1.0.31, but scoped to one project root. The ProjectStateManager owns
 * the lifecycle (creation on first touch, eviction on LRU pressure).
 *
 * Each lazy field follows the "in-flight promise" pattern so concurrent
 * first-call requests don't kick off N parallel inits.
 */
import path from 'node:path';
import { VectorStore } from '../db/VectorStore.js';
import { DependencyGraph } from '../graph/DependencyGraph.js';
import { ASTParser } from '../ast/ASTParser.js';
import { Skeletonizer } from '../ast/Skeletonizer.js';
import { GitOverlayStore } from '../git/GitOverlayStore.js';
import { RuleManager } from '../tools/ruleManager.js';
import { FileWatcher } from '../watcher/FileWatcher.js';
import { PathValidator } from '../security/PathValidator.js';

export interface ProjectState {
  /** Canonical absolute path. Key in ProjectStateManager.map. */
  projectRoot: string;
  /** Path to vectors.lancedb under projectRoot/.ctxloom/ */
  dbPath: string;
  /** Pinned state — survives LRU eviction. Set on the default project at boot. */
  pinned: boolean;
  /** Touched timestamp for LRU. */
  lastTouchedAt: number;
  /** True once Tier 2 (vector indexing) has run for this project. */
  vectorsInitialized: boolean;
  /** True once Tier 1 (graph build/load) has completed. */
  graphInitialized: boolean;
  storePromise: Promise<VectorStore> | null;
  parserPromise: Promise<ASTParser> | null;
  graphPromise: Promise<DependencyGraph> | null;
  skeletonizerPromise: Promise<Skeletonizer> | null;
  ruleManager: RuleManager | null;
  overlay: GitOverlayStore | null;
  watcher: FileWatcher | null;
  pathValidator: PathValidator | null;
}

export function createProjectState(projectRoot: string, opts: { pinned?: boolean } = {}): ProjectState {
  return {
    projectRoot,
    dbPath: path.join(projectRoot, '.ctxloom', 'vectors.lancedb'),
    pinned: opts.pinned ?? false,
    lastTouchedAt: Date.now(),
    vectorsInitialized: false,
    graphInitialized: false,
    storePromise: null,
    parserPromise: null,
    graphPromise: null,
    skeletonizerPromise: null,
    ruleManager: null,
    overlay: null,
    watcher: null,
    pathValidator: null,
  };
}

/**
 * Release OS-level resources held by a project state. Always best-effort;
 * never throws. Idempotent — safe to call on a fresh state.
 */
export async function disposeProjectState(state: ProjectState): Promise<void> {
  try {
    await state.watcher?.stop();
  } catch { /* best-effort */ }
  try {
    const store = state.storePromise ? await state.storePromise : null;
    await store?.close();
  } catch { /* best-effort */ }
  // The remaining fields (graph, parser, skeletonizer, ruleManager, overlay)
  // are pure-JS objects; the next GC collects them once we drop references.
  // Snapshots on disk (.ctxloom/graph-snapshot.json, vectors.lancedb/,
  // git-overlay.json) are NOT deleted — re-warming the same root later
  // skips the parse pass.
  state.watcher = null;
  state.storePromise = null;
  state.graphPromise = null;
  state.parserPromise = null;
  state.skeletonizerPromise = null;
  state.ruleManager = null;
  state.overlay = null;
  state.pathValidator = null;
  state.graphInitialized = false;
  state.vectorsInitialized = false;
}
