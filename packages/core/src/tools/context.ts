import type { PathValidator } from '../security/PathValidator.js';
import type { VectorStore } from '../db/VectorStore.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import type { ASTParser } from '../ast/ASTParser.js';
import type { Skeletonizer } from '../ast/Skeletonizer.js';
import type { RuleManager } from './ruleManager.js';
import type { GitOverlayStore } from '../git/GitOverlayStore.js';
import type { RepoRegistry } from './cross-repo-search.js';

/**
 * ServerContext — handed to every tool's registration callback.
 *
 * v1.1 change: getters now accept an optional `projectRoot` argument.
 * When omitted, the getter operates on the default project (resolved at
 * server boot from CTXLOOM_ROOT env or cwd, post-validation). When
 * passed, the getter operates on that specific project — first-touch
 * triggers a Tier-1 graph build/load against the new root.
 *
 * The `projectRoot` field is preserved for back-compat: it always
 * reports the default project's root. Tools that need per-call routing
 * MUST resolve via the param + registry instead of reading this field.
 */
export interface ServerContext {
  /** The default project root (server-boot resolved). Stays for back-compat. */
  projectRoot: string;
  /** Default project's LanceDB path (back-compat field). */
  dbPath: string;
  /** True when the server entered no-default mode (boot validation failed). */
  noDefaultMode: boolean;

  // ─── Lazy getters (all accept optional projectRoot) ──────────────────
  getStore: (projectRoot?: string) => Promise<VectorStore>;
  getGraph: (projectRoot?: string) => Promise<DependencyGraph>;
  getParser: (projectRoot?: string) => Promise<ASTParser>;
  getSkeletonizer: (projectRoot?: string) => Promise<Skeletonizer>;
  getRuleManager: (projectRoot?: string) => RuleManager;
  getPathValidator: (projectRoot?: string) => PathValidator;

  // ─── Diagnostic (default project only — multi-project view lives in ctx_status) ──
  isStoreInitialized: () => boolean;
  isGraphInitialized: () => boolean;
  isParserInitialized: () => boolean;

  /** Git overlay for the default project (back-compat field). */
  overlay?: GitOverlayStore;

  /** Registry surface for resolveProjectRoot. Stable across requests. */
  registry: RepoRegistry;
}
