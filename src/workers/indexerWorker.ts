// Thin entry point for tsup — the actual worker lives in @ctxloom/core.
// This shim is referenced as a tsup build entry to preserve the output path.
export * from '../../packages/core/src/workers/indexerWorker.js';
