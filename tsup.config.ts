import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import path from 'node:path';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/workers/indexerWorker.ts',
    'src/setup/postinstall.ts',
  ],
  format: ['esm'],
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  noExternal: ['@ctxloom/core', '@ctxloom/mcp-client'],
  // SECURITY: telemetry credentials baked in at build time from env vars.
  // Empty fallback means local source builds are silent. The npm publish
  // pipeline (or `npm run build` with these env vars set) inlines the
  // real keys. Source repo never contains live keys.
  // To set: export CTXLOOM_BUILD_POSTHOG_KEY=phc_... before npm publish.
  define: {
    __TELEMETRY_POSTHOG_KEY__: JSON.stringify(process.env['CTXLOOM_BUILD_POSTHOG_KEY'] ?? ''),
    __TELEMETRY_SENTRY_DSN__: JSON.stringify(process.env['CTXLOOM_BUILD_SENTRY_DSN'] ?? ''),
  },
  async onSuccess() {
    mkdirSync('dist/wasm', { recursive: true });

    // Copy tree-sitter core WASM
    const coreWasmSrc = path.join('node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
    if (existsSync(coreWasmSrc)) {
      copyFileSync(coreWasmSrc, 'dist/wasm/tree-sitter.wasm');
    }

    // Copy grammar WASM files — try multiple locations per package version
    const grammars: Array<{ src: string[]; dest: string }> = [
      {
        src: [
          path.join('node_modules', 'tree-sitter-typescript', 'tree-sitter-typescript.wasm'),
          path.join('node_modules', 'tree-sitter-typescript', 'typescript.wasm'),
          path.join('node_modules', 'tree-sitter-typescript', 'typescript', 'tree-sitter-typescript.wasm'),
        ],
        dest: 'dist/wasm/tree-sitter-typescript.wasm',
      },
      {
        src: [
          path.join('node_modules', 'tree-sitter-typescript', 'tree-sitter-tsx.wasm'),
          path.join('node_modules', 'tree-sitter-typescript', 'tsx.wasm'),
          path.join('node_modules', 'tree-sitter-typescript', 'tsx', 'tree-sitter-tsx.wasm'),
        ],
        dest: 'dist/wasm/tree-sitter-tsx.wasm',
      },
    ];

    for (const grammar of grammars) {
      for (const candidate of grammar.src) {
        if (existsSync(candidate)) {
          copyFileSync(candidate, grammar.dest);
          break;
        }
      }
    }

    console.log('[tsup] WASM assets copied to dist/wasm/');
  },
});
