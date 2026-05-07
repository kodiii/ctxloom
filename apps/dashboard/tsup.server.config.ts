/**
 * Bundle the dashboard's Express server with tsup.
 *
 * Why tsup (not tsc): the server imports `@ctxloom/core`, whose
 * package.json points `main` at TypeScript source. tsc enforces
 * `rootDir`, which forbids reaching into another workspace's source —
 * so plain tsc fails with TS6059 on every cross-package import.
 *
 * tsup bundles everything into a single output, sidesteps the rootDir
 * problem, and matches what the root CLI build already does.
 *
 * Output: dist/server/index.js — the path that src/dashboard.ts in the
 * root CLI dynamically imports to spawn the dashboard.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'server/index.ts' },
  outDir: 'dist/server',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace-internal package; we WANT it bundled in so the published
  // CLI doesn't need a separate @ctxloom/core dist.
  noExternal: ['@ctxloom/core'],
  // Keep these external — they're npm deps the runtime resolves at load
  // time. Native bindings (sharp, onnxruntime, lancedb), big ML stacks
  // (@huggingface/transformers), and CJS-only packages must NOT be
  // bundled into the ESM output: their dynamic requires break under
  // tsup's CJS→ESM shim.
  external: [
    'express',
    'cors',
    'open',
    // Native modules
    'sharp',
    'onnxruntime-node',
    'onnxruntime-web',
    'web-tree-sitter',
    /^@lancedb\/.*/,
    /^tree-sitter-.*/,
    // ML stack — pulls sharp transitively
    '@huggingface/transformers',
    '@xenova/transformers',
    // CJS-only packages: their dynamic require('fs') / require('util')
    // calls break under tsup's CJS→ESM shim. Keep external so Node's
    // resolver loads them directly.
    'simple-git',
    /^@kwsites\/.*/,
    'debug',
    'micromatch',
    'graphology',
    /^graphology-.*/,
  ],
  splitting: false,
  bundle: true,
});
