/**
 * Bundle the ctxloom Action entrypoint.
 *
 * Mirror of apps/dashboard/tsup.server.config.ts. We're a Docker action,
 * so the runtime container has a real node_modules — heavy native deps
 * (lancedb, onnxruntime, tree-sitter) stay external and resolve there
 * at load time. Only @ctxloom/core gets bundled in so we don't need a
 * separate core dist inside the image.
 */
import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootVersion = (
  JSON.parse(readFileSync(path.resolve('..', '..', 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

export default defineConfig({
  entry: { index: 'src/action.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: ['@ctxloom/core'],
  external: [
    '@octokit/rest',
    '@octokit/core',
    'yaml',
    'js-yaml',
    'zod',
    // Heavy / native — must live in node_modules at runtime.
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
  define: {
    // pr-bot only emits crash events to Sentry; analytics don't make sense
    // from a fan-out CI surface. SENTRY_DSN can be set at runtime via the
    // workflow's `env:` block; build-time fallback stays empty so forks
    // produce a zero-telemetry binary by default.
    __TELEMETRY_POSTHOG_KEY__: JSON.stringify(''),
    __TELEMETRY_SENTRY_DSN__: JSON.stringify(''),
    __CTXLOOM_VERSION__: JSON.stringify(rootVersion),
  },
});
