import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { CliInstaller, type FetchLike } from '../../src/client/CliInstaller.js';

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

import crypto from 'node:crypto';

function makeFakeTarball(): { bytes: Buffer; sha256: string } {
  const bytes = Buffer.from('fake-tarball-contents');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return { bytes, sha256 };
}

function makeFakeFetch(map: Record<string, { status: number; body?: Buffer | string; headers?: Record<string, string> }>) {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    const entry = map[urlStr];
    if (!entry) {
      return new Response('not found', { status: 404 });
    }
    let bodyToSend: string;
    if (entry.body instanceof Buffer) {
      bodyToSend = entry.body.toString();
    } else if (typeof entry.body === 'string') {
      bodyToSend = entry.body;
    } else {
      bodyToSend = '';
    }
    return new Response(bodyToSend, { status: entry.status, headers: entry.headers });
  }) as any;
}

describe('CliInstaller — download + verify', () => {
  let storage: string;
  beforeEach(() => { storage = makeStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  it('downloads tarball + sidecar and verifies SHA-256 (happy path)', async () => {
    const { bytes, sha256 } = makeFakeTarball();
    const tarUrl = 'https://example.test/cli-v1.0.5/ctxloom-cli-1.0.5-linux-x64.tar.gz';
    const shaUrl = `${tarUrl}.sha256`;
    const fetch = makeFakeFetch({
      [tarUrl]: { status: 200, body: bytes },
      [shaUrl]: { status: 200, body: `${sha256}  ctxloom-cli-1.0.5-linux-x64.tar.gz\n` },
    }) as FetchLike;
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const tmpFile = await installer.downloadVerified('1.0.5');
    expect(tmpFile.endsWith('.tar.gz')).toBe(true);
    expect(fs.readFileSync(tmpFile)).toEqual(bytes);
  });

  it('throws ChecksumMismatch when SHA-256 does not match', async () => {
    const { bytes } = makeFakeTarball();
    const tarUrl = 'https://example.test/cli-v1.0.5/ctxloom-cli-1.0.5-linux-x64.tar.gz';
    const shaUrl = `${tarUrl}.sha256`;
    const fetch = makeFakeFetch({
      [tarUrl]: { status: 200, body: bytes },
      [shaUrl]: { status: 200, body: '0000000000000000000000000000000000000000000000000000000000000000  x.tar.gz\n' },
    }) as FetchLike;
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    await expect(installer.downloadVerified('1.0.5')).rejects.toThrow(/checksum/i);
    // Partial download cleaned up
    const tmp = path.join(storage, 'tmp');
    if (fs.existsSync(tmp)) {
      const remaining = fs.readdirSync(tmp).filter(f => f.endsWith('.tar.gz'));
      expect(remaining).toEqual([]);
    }
  });

  it('throws NotFound on 404', async () => {
    const fetch = makeFakeFetch({}) as FetchLike; // every URL → 404
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    await expect(installer.downloadVerified('1.0.5')).rejects.toThrow(/not found|404/i);
  });

  it('builds correct GitHub Releases URLs from version + platform', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 })) as any;
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), platform: 'darwin-arm64' });
    await expect(installer.downloadVerified('1.0.5')).rejects.toThrow();
    const calls = fetch.mock.calls.map((c: any[]) => String(c[0] ?? ''));
    expect(calls).toContain('https://github.com/kodiii/ctxloom/releases/download/cli-v1.0.5/ctxloom-cli-1.0.5-darwin-arm64.tar.gz.sha256');
  });
});
