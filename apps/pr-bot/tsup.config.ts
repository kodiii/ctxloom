/**
 * Bundle the pr-bot with tsup, mirroring apps/dashboard.
 *
 * Why tsup (not tsc): `@ctxloom/core`'s package.json points `main` at
 * TypeScript source. tsc enforces `rootDir`, which forbids reaching into
 * another workspace's source — so plain tsc fails with TS6059 on every
 * cross-package import. tsup bundles everything into a single output and
 * sidesteps the rootDir problem (same pattern the dashboard and the
 * root CLI build already use).
 *
 * Output: dist/index.js — the entry the Dockerfile launches with
 * `node dist/index.js`.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace-internal package; bundle it in so the deployed image
  // doesn't need a separate @ctxloom/core dist.
  noExternal: ['@ctxloom/core'],
  external: [
    // Big runtime deps the container resolves from node_modules. Native
    // bindings and CJS-only packages must NOT be bundled into ESM.
    'probot',
    'pino',
    'yaml',
    'zod',
    /^@octokit\/.*/,
    /^@lancedb\/.*/,
    'sharp',
    'onnxruntime-node',
    'onnxruntime-web',
    'web-tree-sitter',
    /^tree-sitter-.*/,
    '@huggingface/transformers',
    '@xenova/transformers',
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
