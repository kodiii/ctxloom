#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extRoot, '../..');
const target = path.join(extRoot, 'resources', 'ctxloom-cli');

// Build ctxloom-pro from the workspace.
console.log('[prepare-bundle] Running ctxloom-pro build…');
const { execSync } = await import('node:child_process');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });

// Copy dist + node_modules + package.json (production-only deps).
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
copyDir(path.join(repoRoot, 'dist'), path.join(target, 'dist'));
copyDir(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'), {
  skip: name => name === '.cache' || name === '.bin' || name.startsWith('@types') || name.includes('vitest') || name.includes('@vscode'),
});
fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(target, 'package.json'));

console.log(`[prepare-bundle] Bundled ctxloom-pro → ${path.relative(extRoot, target)}`);

function copyDir(src, dst, opts = {}) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (opts.skip && opts.skip(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isSymbolicLink()) {
      // Resolve symlink — skip if it points back into the monorepo (workspace packages)
      // or into the target directory we are building (would cause infinite recursion).
      let real;
      try { real = fs.realpathSync(s); } catch { continue; }
      if (real.startsWith(repoRoot + '/apps/') || real.startsWith(repoRoot + '/packages/') || real.startsWith(target)) continue;
      const stat = fs.statSync(real);
      if (stat.isDirectory()) copyDir(real, d, opts);
      else fs.copyFileSync(real, d);
    } else if (e.isDirectory()) {
      copyDir(s, d, opts);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
