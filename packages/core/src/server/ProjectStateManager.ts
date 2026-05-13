/**
 * ProjectStateManager — per-project state cache with LRU eviction.
 *
 * The server holds exactly one ProjectStateManager. Every tool call's
 * resolveProjectRoot output keys into it. First touch creates a state,
 * subsequent touches return the cached one. When the configured cap is
 * exceeded, the LRU non-pinned entry is evicted (its handles released
 * via the configured onDispose callback, defaulting to disposeProjectState).
 *
 * Pinned entries are exempt from eviction. The default project (resolved
 * at server boot from CTXLOOM_ROOT or cwd, post-validation) is pinned.
 * If validation fails, no default is pinned and the server runs in
 * "no-default mode" — see src/server.ts.
 *
 * get() is synchronous: state creation is a constant-time object
 * allocation. The expensive work (graph build, vector init) is gated on
 * the lazy fields inside ProjectState, triggered by tool calls.
 */
import { ProjectState, createProjectState, disposeProjectState } from './ProjectState.js';
import { logger } from '../utils/logger.js';
import { track, captureError } from '../license/telemetry.js';
import { hashProjectRoot } from './projectId.js';

export interface ProjectStateManagerOptions {
  /** Max active (non-pinned + pinned) entries. Default 5. */
  maxProjects?: number;
  /** Callback fired before a state is removed. Default: disposeProjectState. */
  onDispose?: (state: ProjectState) => Promise<void>;
}

const DEFAULT_MAX_PROJECTS = 5;

export class ProjectStateManager {
  private readonly map = new Map<string, ProjectState>();
  private readonly maxProjects: number;
  private readonly onDispose: (state: ProjectState) => Promise<void>;

  constructor(opts: ProjectStateManagerOptions = {}) {
    this.maxProjects = opts.maxProjects ?? DEFAULT_MAX_PROJECTS;
    this.onDispose = opts.onDispose ?? disposeProjectState;
  }

  size(): number {
    return this.map.size;
  }

  /** The configured maximum number of active project states. */
  get max(): number {
    return this.maxProjects;
  }

  has(root: string): boolean {
    return this.map.has(root);
  }

  /**
   * Get-or-create the state for `root`. Updates lastTouchedAt on every call.
   * Throws if creating a new entry would exceed maxProjects and no non-pinned
   * entry can be evicted.
   */
  get(root: string): ProjectState {
    const existing = this.map.get(root);
    if (existing) {
      existing.lastTouchedAt = Date.now();
      return existing;
    }
    if (this.map.size >= this.maxProjects) {
      this.evictLRU();
    }
    const fresh = createProjectState(root);
    this.map.set(root, fresh);
    return fresh;
  }

  /**
   * Create-and-pin a state. Used for the default project at server boot
   * (when it passes validation). Pinned states never get LRU-evicted.
   */
  pin(root: string): ProjectState {
    const state = this.get(root);
    state.pinned = true;
    return state;
  }

  /**
   * List all active states ordered most-recently-touched first.
   */
  list(): ProjectState[] {
    return Array.from(this.map.values()).sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);
  }

  /**
   * Evict the LRU non-pinned entry. Throws if all entries are pinned.
   */
  private evictLRU(): void {
    let victim: ProjectState | undefined;
    for (const state of this.map.values()) {
      if (state.pinned) continue;
      if (!victim || state.lastTouchedAt < victim.lastTouchedAt) {
        victim = state;
      }
    }
    if (!victim) {
      throw new Error(
        `ProjectStateManager: cannot evict — all ${this.map.size} entries are pinned. ` +
        `Raise CTXLOOM_MAX_PROJECTS or unpin entries.`,
      );
    }
    this.map.delete(victim.projectRoot);
    const pinnedCount = Array.from(this.map.values()).filter(s => s.pinned).length;
    track('project_evicted', {
      project_id: hashProjectRoot(victim.projectRoot),
      pinned_count: pinnedCount,
      cap: this.maxProjects,
    });
    // Fire-and-forget — the LRU eviction signal isn't waitable from a
    // synchronous get() call. Dispose errors are swallowed inside
    // disposeProjectState.
    void this.onDispose(victim)
      .then(() => {
        logger.info('project.evicted', {
          root: victim!.projectRoot,
          reason: 'lru_cap_reached',
          ttl_seconds: Math.round((Date.now() - victim!.lastTouchedAt) / 1000),
        });
      })
      .catch(err => {
        captureError(err, {
          project_id: hashProjectRoot(victim!.projectRoot),
          phase: 'dispose',
        });
      });
  }

  /**
   * Dispose all states and clear the map. Use only on shutdown.
   */
  async drain(): Promise<void> {
    for (const state of this.map.values()) {
      await this.onDispose(state);
    }
    this.map.clear();
  }
}
