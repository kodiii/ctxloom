#!/usr/bin/env node
/**
 * Compile fake-cli/index.ts → fake-cli/dist/index.js, pack into a tarball,
 * write a SHA-256 sidecar. Used by CliInstaller integration tests via file:// URLs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeCliDir = path.join(__dirname, 'fake-cli');
const distDir = path.join(fakeCliDir, 'dist');

fs.mkdirSync(distDir, { recursive: true });
execSync(`npx esbuild "${path.join(fakeCliDir, 'index.ts')}" --bundle --platform=node --format=esm --outfile="${path.join(distDir, 'index.js')}"`, { stdio: 'inherit' });

const stagingDir = path.join(__dirname, '.fake-staging');
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
fs.cpSync(fakeCliDir, path.join(stagingDir, 'package'), { recursive: true });

const tarPath = path.join(__dirname, 'fake-cli.tar.gz');
execSync(`tar -czf "${tarPath}" -C "${stagingDir}" package`);
fs.rmSync(stagingDir, { recursive: true, force: true });

const sha = crypto.createHash('sha256').update(fs.readFileSync(tarPath)).digest('hex');
fs.writeFileSync(`${tarPath}.sha256`, `${sha}  ${path.basename(tarPath)}\n`);
console.log(`[fake-cli] Wrote ${tarPath} (sha=${sha.slice(0, 12)}…)`);
