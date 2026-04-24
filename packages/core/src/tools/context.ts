import type { PathValidator } from '../security/PathValidator.js';
import type { VectorStore } from '../db/VectorStore.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import type { ASTParser } from '../ast/ASTParser.js';
import type { Skeletonizer } from '../ast/Skeletonizer.js';
import type { RuleManager } from './ruleManager.js';
import type { GitOverlayStore } from '../git/GitOverlayStore.js';

export interface ServerContext {
  projectRoot: string;
  dbPath: string;
  getStore: () => Promise<VectorStore>;
  getGraph: () => Promise<DependencyGraph>;
  getParser: () => Promise<ASTParser>;
  getSkeletonizer: () => Promise<Skeletonizer>;
  getRuleManager: () => RuleManager;
  getPathValidator: () => PathValidator;
  // Diagnostic — returns whether the promise has been started (not whether it resolved)
  isStoreInitialized: () => boolean;
  isGraphInitialized: () => boolean;
  isParserInitialized: () => boolean;
  overlay?: GitOverlayStore;
}
