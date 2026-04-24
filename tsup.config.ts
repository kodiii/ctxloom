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
