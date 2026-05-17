#!/usr/bin/env node
/**
 * Build platform-specific tarballs of ctxloom-pro for the v1.1 lazy-install flow.
 * Produces dist-cli/ctxloom-cli-<version>-<platform>.tar.gz + .sha256 sidecar.
 *
 * Usage:
 *   node scripts/cli-tarballs/build-cli-tarballs.mjs --platform=linux-x64
 *   node scripts/cli-tarballs/build-cli-tarballs.mjs    # host's native platform
 *
 * The script always runs `npm install --omit=dev` for the platform it's running on
 * (cross-platform native binaries via npm_config_target_* are out of scope for v1.1 —
 * the publish workflow runs the matrix across native runners).
 *
 * Originally lived under apps/vscode-extension/scripts/; promoted to a
 * top-level scripts/ location when the vscode-extension app was dropped
 * (the script never depended on extension state, only on the monorepo
 * root, so the move is purely path bookkeeping).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/cli-tarballs/build-cli-tarballs.mjs → repo root is 2 levels up.
const repoRoot = path.resolve(__dirname, '..', '..');
const distCli = path.join(repoRoot, 'dist-cli');

function detectPlatform() {
  const flag = process.argv.find(a => a.startsWith('--platform='));
  if (flag) return flag.slice('--platform='.length);
  const p = process.platform, a = process.arch;
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64';
  if (p === 'darwin' && a === 'x64') return 'darwin-x64';
  if (p === 'linux' && a === 'x64') return 'linux-x64';
  if (p === 'linux' && a === 'arm64') return 'linux-arm64';
  throw new Error(`Unsupported host platform: ${p}/${a}. Pass --platform=<name>.`);
}

const platform = detectPlatform();
console.log(`[build-cli-tarballs] Building for ${platform}…`);

console.log('[build-cli-tarballs] Building ctxloom-pro…');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });

console.log('[build-cli-tarballs] Packing ctxloom-pro…');
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-pack-'));
const packOutput = execSync('npm pack --json', { cwd: repoRoot, encoding: 'utf-8' });
const packed = JSON.parse(packOutput);
const tarballName = packed[0].filename;
const tarballPath = path.resolve(repoRoot, tarballName);
const version = packed[0].version;

execSync(`tar -xzf "${tarballPath}" -C "${packDir}"`, { stdio: 'inherit' });
fs.rmSync(tarballPath, { force: true });
const packageDir = path.join(packDir, 'package');

// Strip workspace deps (e.g. @ctxloom/core) — they're tsup-bundled into dist/.
const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
const removed = [];
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (dep.startsWith('@ctxloom/')) { delete pkg.dependencies[dep]; removed.push(dep); }
}
if (removed.length) console.log('[build-cli-tarballs] Removed bundled workspace deps:', removed.join(', '));
fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(pkg, null, 2));

console.log('[build-cli-tarballs] Installing production deps…');
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts', {
  cwd: packageDir,
  stdio: 'inherit',
});

// Strip onnxruntime-node binaries for OTHER platforms.
const ortNodeDir = path.join(packageDir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
if (fs.existsSync(ortNodeDir)) {
  const [hostOs] = platform.split('-');
  for (const dir of fs.readdirSync(ortNodeDir)) {
    if (dir !== hostOs) {
      console.log(`[build-cli-tarballs] Pruning onnxruntime-node/${dir} (not needed on ${platform})`);
      fs.rmSync(path.join(ortNodeDir, dir), { recursive: true, force: true });
    }
  }
}

fs.mkdirSync(distCli, { recursive: true });
const outName = `ctxloom-cli-${version}-${platform}.tar.gz`;
const outPath = path.join(distCli, outName);

execSync(`tar -czf "${outPath}" -C "${packDir}" package`, { stdio: 'inherit' });

const bytes = fs.readFileSync(outPath);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(`${outPath}.sha256`, `${sha}  ${outName}\n`);
fs.rmSync(packDir, { recursive: true, force: true });

console.log(`[build-cli-tarballs] Wrote ${outName} (${(bytes.length / 1024 / 1024).toFixed(1)} MB) + .sha256`);
console.log(`[build-cli-tarballs] SHA-256: ${sha}`);
