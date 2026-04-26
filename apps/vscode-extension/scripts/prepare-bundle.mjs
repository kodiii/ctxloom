#!/usr/bin/env node
/**
 * Build ctxloom-pro and bundle ONLY its production dependencies into
 * `apps/vscode-extension/resources/ctxloom-cli/`. Uses `npm pack` + a
 * clean `npm install --omit=dev` in a temp dir to avoid pulling in the
 * monorepo's hoisted dev deps (which would inflate the VSIX past the
 * 50 MB marketplace limit by 20x).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extRoot, '../..');
const target = path.join(extRoot, 'resources', 'ctxloom-cli');

console.log('[prepare-bundle] Building ctxloom-pro…');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });

console.log('[prepare-bundle] Packing ctxloom-pro…');
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-pack-'));
const packOutput = execSync('npm pack --json', { cwd: repoRoot, encoding: 'utf-8' });
const packed = JSON.parse(packOutput);
const tarballName = packed[0].filename;
const tarballPath = path.resolve(repoRoot, tarballName);

console.log(`[prepare-bundle] Extracting ${tarballName} → ${packDir}`);
execSync(`tar -xzf "${tarballPath}" -C "${packDir}"`, { stdio: 'inherit' });
fs.rmSync(tarballPath, { force: true });

const packageDir = path.join(packDir, 'package');

// Remove workspace-only deps (e.g. @ctxloom/core) from the extracted package.json
// before running `npm install`. These packages are bundled into dist/ via tsup's
// `noExternal` config and are not available on the npm registry.
const pkgJsonPath = path.join(packageDir, 'package.json');
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
const WORKSPACE_SCOPE = '@ctxloom/';
for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  if (!pkgJson[section]) continue;
  const removed = [];
  for (const dep of Object.keys(pkgJson[section])) {
    if (dep.startsWith(WORKSPACE_SCOPE)) {
      delete pkgJson[section][dep];
      removed.push(dep);
    }
  }
  if (removed.length) console.log(`[prepare-bundle] Removed bundled workspace deps from ${section}: ${removed.join(', ')}`);
}
fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2), 'utf-8');

console.log('[prepare-bundle] Installing production dependencies (this can take ~30-60s)…');
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts', {
  cwd: packageDir,
  stdio: 'inherit',
});

// ── Platform pruning ────────────────────────────────────────────────────────
// onnxruntime-node ships prebuilt binaries for darwin/linux/win32 in
// bin/napi-v3/<platform>/<arch>/.  Keep only the current platform's binaries
// to avoid bundling ~146 MB of binaries that can never run in the VSIX target.
// (Platform-specific VSIXes are built per-platform anyway; for a universal VSIX
// these other-platform .node files would be dead weight.)
const CURRENT_PLATFORM = process.platform; // 'darwin' | 'linux' | 'win32'
const ortNodeBin = path.join(packageDir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
if (fs.existsSync(ortNodeBin)) {
  for (const entry of fs.readdirSync(ortNodeBin, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== CURRENT_PLATFORM) {
      const platformDir = path.join(ortNodeBin, entry.name);
      fs.rmSync(platformDir, { recursive: true, force: true });
      console.log(`[prepare-bundle] Pruned onnxruntime-node/${entry.name} (not needed on ${CURRENT_PLATFORM})`);
    }
  }
}

console.log(`[prepare-bundle] Copying to ${path.relative(extRoot, target)}…`);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
copyDir(packageDir, target);
fs.rmSync(packDir, { recursive: true, force: true });

const stats = sizeOf(target);
console.log(`[prepare-bundle] Bundle ready: ${stats.fileCount} files, ${formatBytes(stats.totalBytes)}`);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
    // Skip symlinks (can cause issues in the VSIX).
  }
}

function sizeOf(dir) {
  let totalBytes = 0;
  let fileCount = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = sizeOf(p);
      totalBytes += sub.totalBytes;
      fileCount += sub.fileCount;
    } else if (e.isFile()) {
      totalBytes += fs.statSync(p).size;
      fileCount++;
    }
  }
  return { totalBytes, fileCount };
}

function formatBytes(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
