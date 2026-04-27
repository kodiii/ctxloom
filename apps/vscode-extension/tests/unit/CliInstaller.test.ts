import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { CliInstaller } from '../../src/client/CliInstaller.js';

function makeStorage(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-installer-'));
}

function quietLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn(), dispose: vi.fn() };
}

function nullPrompt() {
  return { confirmInstall: async () => 'install' as const, alreadyDismissed: () => false };
}

function nullProgress() {
  return { withProgress: async <T,>(_title: string, body: (_report: (delta: { increment?: number; message?: string }) => void) => Promise<T>): Promise<T> => body(() => {}) };
}

describe('CliInstaller — paths and idempotency', () => {
  let storage: string;
  beforeEach(() => { storage = makeStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  it('resolves the installed binary path for a given version', () => {
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    const p = installer.installedBinaryPath('1.0.5');
    expect(p).toBe(path.join(storage, 'ctxloom-cli', '1.0.5', 'dist', 'index.js'));
  });

  it('reports installed=false when the binary is missing', () => {
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    expect(installer.isInstalled('1.0.5')).toBe(false);
  });

  it('reports installed=true when the binary exists', () => {
    const dir = path.join(storage, 'ctxloom-cli', '1.0.5', 'dist');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    expect(installer.isInstalled('1.0.5')).toBe(true);
  });

  it('cleanupStaging() deletes any tmp/staging-* directories', () => {
    const tmp = path.join(storage, 'tmp');
    fs.mkdirSync(path.join(tmp, 'staging-1.0.4'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'staging-1.0.5'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'unrelated.txt'), 'keep me');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    installer.cleanupStaging();
    expect(fs.existsSync(path.join(tmp, 'staging-1.0.4'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'staging-1.0.5'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'unrelated.txt'))).toBe(true);
  });

  it('cleanupStaging() is a no-op when tmp/ does not exist', () => {
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    expect(() => installer.cleanupStaging()).not.toThrow();
  });
});
