import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import type { Logger } from '../shared/logger.js';

/** Asks the user whether to proceed with a download. */
export interface InstallPrompt {
  confirmInstall(version: string): Promise<'install' | 'skip' | 'dont-ask-again'>;
  alreadyDismissed(): boolean;
}

/** Wraps `vscode.window.withProgress` so the installer doesn't depend on `vscode` directly. */
export interface ProgressReporter {
  withProgress<T>(
    title: string,
    body: (
      report: (delta: { increment?: number; message?: string }) => void,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T>;
}

export type FetchLike = typeof globalThis.fetch;

export interface CliInstallerOptions {
  globalStorageRoot: string;
  fetch: FetchLike;
  logger: Logger;
  prompt: InstallPrompt;
  progress: ProgressReporter;
  /** Override URL base for tests. Default 'https://github.com/kodiii/ctxloom/releases/download'. */
  releaseBaseUrl?: string;
  /** Override platform key for tests. Default derived from process.platform/arch. */
  platform?: Platform;
}

export type Platform = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'linux-arm64';

const RELEASE_BASE_URL = 'https://github.com/kodiii/ctxloom/releases/download';
const MAX_RETRIES_PER_SESSION = 3;

export class CliInstaller {
  constructor(private readonly opts: CliInstallerOptions) {}

  installedBinaryPath(version: string): string {
    return path.join(this.opts.globalStorageRoot, 'ctxloom-cli', version, 'dist', 'index.js');
  }

  isInstalled(version: string): boolean {
    return fs.existsSync(this.installedBinaryPath(version));
  }

  /** Delete every `tmp/staging-*` directory. Called on installer entry to recover from crashed installs. */
  cleanupStaging(): void {
    const tmp = path.join(this.opts.globalStorageRoot, 'tmp');
    if (!fs.existsSync(tmp)) return;
    for (const entry of fs.readdirSync(tmp)) {
      if (entry.startsWith('staging-')) {
        fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
      }
    }
  }

  private resolvePlatform(): Platform {
    if (this.opts.platform) return this.opts.platform;
    const p = process.platform;
    const a = process.arch;
    if (p === 'darwin' && a === 'arm64') return 'darwin-arm64';
    if (p === 'darwin' && a === 'x64') return 'darwin-x64';
    if (p === 'linux' && a === 'x64') return 'linux-x64';
    if (p === 'linux' && a === 'arm64') return 'linux-arm64';
    throw new Error(`Unsupported platform: ${p}/${a}`);
  }

  private buildUrls(version: string): { tarUrl: string; shaUrl: string; tarballName: string } {
    const platform = this.resolvePlatform();
    const base = this.opts.releaseBaseUrl ?? RELEASE_BASE_URL;
    const tarballName = `ctxloom-cli-${version}-${platform}.tar.gz`;
    const tarUrl = `${base}/cli-v${version}/${tarballName}`;
    return { tarUrl, shaUrl: `${tarUrl}.sha256`, tarballName };
  }

  /**
   * Download the tarball + sidecar, verify SHA-256, return the path to the
   * downloaded tarball under `${globalStorageRoot}/tmp/`. The caller is
   * responsible for extraction (`extractAndCommit`) — keeping these split
   * lets the install-flow recover from extract failures without re-downloading.
   */
  async downloadVerified(version: string, signal?: AbortSignal): Promise<string> {
    const { tarUrl, shaUrl, tarballName } = this.buildUrls(version);

    // Sidecar first — small, fails fast on 404.
    const shaRes = await this.opts.fetch(shaUrl, { signal });
    if (shaRes.status === 404) throw new Error(`Tarball not found: 404 at ${shaUrl}`);
    if (!shaRes.ok) throw new Error(`Sidecar download failed: HTTP ${shaRes.status}`);
    const shaText = await shaRes.text();
    const expectedSha = (shaText.split(/\s+/)[0] ?? '').trim();
    if (!/^[0-9a-f]{64}$/.test(expectedSha)) {
      throw new Error(`Malformed sha256 sidecar at ${shaUrl}: ${shaText.slice(0, 80)}`);
    }

    const tarRes = await this.opts.fetch(tarUrl, { signal });
    if (tarRes.status === 404) throw new Error(`Tarball not found: 404 at ${tarUrl}`);
    if (!tarRes.ok) throw new Error(`Tarball download failed: HTTP ${tarRes.status}`);
    const buf = Buffer.from(await tarRes.arrayBuffer());

    const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
    if (actualSha !== expectedSha) {
      throw new Error(`Checksum mismatch: expected ${expectedSha.slice(0, 12)}…, got ${actualSha.slice(0, 12)}…`);
    }

    const tmp = path.join(this.opts.globalStorageRoot, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const tarPath = path.join(tmp, tarballName);
    fs.writeFileSync(tarPath, buf);
    this.opts.logger.info(`downloaded + verified ${tarballName} (${buf.length} bytes)`);
    return tarPath;
  }

  /**
   * Extract `tarPath` into `${globalStorageRoot}/tmp/staging-${version}/`,
   * atomic-rename to the final versioned directory, write `INSTALLED_VERSION`,
   * delete tarball + previous version. Throws on any failure (caller must
   * catch and surface to user).
   */
  async extractAndCommit(version: string, tarPath: string): Promise<void> {
    const tmp = path.join(this.opts.globalStorageRoot, 'tmp');
    const staging = path.join(tmp, `staging-${version}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });

    try {
      execSync(`tar -xzf "${tarPath}" -C "${staging}"`, { stdio: 'pipe' });
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw new Error(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Read previous version (if any) before the rename.
    const versionFile = path.join(this.opts.globalStorageRoot, 'INSTALLED_VERSION');
    let previousVersion: string | null = null;
    if (fs.existsSync(versionFile)) {
      previousVersion = fs.readFileSync(versionFile, 'utf-8').trim();
    }

    const finalDir = path.join(this.opts.globalStorageRoot, 'ctxloom-cli', version);
    fs.mkdirSync(path.dirname(finalDir), { recursive: true });
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(staging, finalDir);

    // Commit: atomic write of INSTALLED_VERSION via tmp + rename.
    const versionTmp = `${versionFile}.tmp`;
    fs.writeFileSync(versionTmp, version);
    fs.renameSync(versionTmp, versionFile);

    // Best-effort cleanup of tarball + previous version directory.
    fs.rmSync(tarPath, { force: true });
    if (previousVersion !== null && previousVersion !== version) {
      fs.rmSync(path.join(this.opts.globalStorageRoot, 'ctxloom-cli', previousVersion), { recursive: true, force: true });
    }
    this.opts.logger.info(`installed ctxloom-cli ${version}`);
  }

  private failureCount = 0;

  async ensureInstalled(version: string, signal?: AbortSignal): Promise<EnsureResult> {
    if (this.isInstalled(version)) {
      return { kind: 'already-installed', binaryPath: this.installedBinaryPath(version) };
    }

    if (this.opts.prompt.alreadyDismissed()) {
      return { kind: 'dismissed' };
    }

    if (this.failureCount >= MAX_RETRIES_PER_SESSION) {
      return { kind: 'exhausted' };
    }

    // Always clean up any leftover staging dirs before a fresh attempt.
    this.cleanupStaging();

    const decision = await this.opts.prompt.confirmInstall(version);
    if (decision === 'skip') return { kind: 'skipped' };
    if (decision === 'dont-ask-again') return { kind: 'dismissed' };

    try {
      await this.opts.progress.withProgress(`Installing ctxloom analyzer (${version})`, async (report, progressSignal) => {
        const effectiveSignal = signal ?? progressSignal;
        report({ message: 'Downloading…' });
        const tarPath = await this.downloadVerified(version, effectiveSignal);
        report({ message: 'Installing…' });
        await this.extractAndCommit(version, tarPath);
      });
      return { kind: 'installed', binaryPath: this.installedBinaryPath(version) };
    } catch (err) {
      this.failureCount++;
      this.opts.logger.error(`ctxloom CLI install failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  resetFailureCount(): void { this.failureCount = 0; }
}

export type EnsureResult =
  | { kind: 'already-installed'; binaryPath: string }
  | { kind: 'installed'; binaryPath: string }
  | { kind: 'skipped' }
  | { kind: 'dismissed' }
  | { kind: 'exhausted' };
