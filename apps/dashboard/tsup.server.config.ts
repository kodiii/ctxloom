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
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Read root package.json — the dashboard ships as part of the root
// ctxloom-pro tarball and uses the same release version.
const pkgVersion = (
  JSON.parse(readFileSync(path.resolve('..', '..', 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

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
  // SECURITY: telemetry credentials baked in at build time from env vars,
  // mirroring the root tsup.config.ts. Required because `noExternal:
  // ['@ctxloom/core']` bundles core's telemetry module DIRECTLY into the
  // dashboard server output, so it needs its own copy of the defines.
  // Without these, the server's `track()` short-circuits on the empty
  // POSTHOG_KEY guard and silently drops every dashboard_loaded /
  // dashboard_page_viewed event — exactly the v1.1.3–v1.1.4 silent drop
  // that this fix exists to plug.
  define: {
    __TELEMETRY_POSTHOG_KEY__: JSON.stringify(process.env['CTXLOOM_BUILD_POSTHOG_KEY'] ?? ''),
    __TELEMETRY_SENTRY_DSN__: JSON.stringify(process.env['CTXLOOM_BUILD_SENTRY_DSN'] ?? ''),
    __CTXLOOM_VERSION__: JSON.stringify(pkgVersion),
  },
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
