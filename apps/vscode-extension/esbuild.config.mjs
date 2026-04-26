import * as esbuild from 'esbuild';
import * as fs from 'node:fs';

const watch = process.argv.includes('--watch');

// Extension bundle (Node CJS, externalizes vscode).
const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
});

// Webview bundle (browser ESM, no externals).
const webviewCtx = await esbuild.context({
  entryPoints: ['src/settings/webview/main.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: 'dist/webview/main.js',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
});

// Copy CSS as-is.
fs.mkdirSync('dist/webview', { recursive: true });
fs.copyFileSync('src/settings/webview/styles.css', 'dist/webview/styles.css');

if (watch) {
  await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
} else {
  await extensionCtx.rebuild(); await extensionCtx.dispose();
  await webviewCtx.rebuild(); await webviewCtx.dispose();
}
