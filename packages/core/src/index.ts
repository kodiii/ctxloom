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
export * from '../../../src/graph/DependencyGraph.js';
export * from '../../../src/git/GitOverlayStore.js';
