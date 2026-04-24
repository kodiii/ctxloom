/**
 * @ctxloom/core — shared library for all ctxloom apps.
 *
 * This package is workspace-private and never published to npm.
 * main/types/exports intentionally point at .ts source because:
 *   - Development: consumers use tsx which resolves .ts natively
 *   - Production: tsup bundles core inline via noExternal
 *
 * STUB PHASE: This index currently re-exports only the symbols apps need
 * today. Task 22 replaces this with a curated public API once all
 * subdirectories are migrated from src/ into packages/core/src/.
 */
export * from './graph/DependencyGraph.js';
export * from './git/GitOverlayStore.js';
export * from './lib/index.js';
export * from './utils/logger.js';
export * from './utils/GoModuleResolver.js';
export * from './utils/TsConfigPathsResolver.js';
export * from './utils/importExtractor.js';
export * from './utils/notebookExtractor.js';
export * from './grammars/GrammarLoader.js';
export * from './grammars/grammar-manifest.js';
export * from './ast/ASTParser.js';
export * from './ast/Skeletonizer.js';
