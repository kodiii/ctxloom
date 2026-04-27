import path from 'node:path';
import fs from 'node:fs';
import type { Logger } from '../shared/logger.js';

/** Asks the user whether to proceed with a download. */
export interface InstallPrompt {
  confirmInstall(version: string): Promise<'install' | 'skip' | 'dont-ask-again'>;
  alreadyDismissed(): boolean;
}

/** Wraps `vscode.window.withProgress` so the installer doesn't depend on `vscode` directly. */
export interface ProgressReporter {
  withProgress<T>(title: string, body: (report: (delta: { increment?: number; message?: string }) => void) => Promise<T>): Promise<T>;
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
}
