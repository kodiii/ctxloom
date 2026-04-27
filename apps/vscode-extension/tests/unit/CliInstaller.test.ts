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
  return {
    withProgress: async <T,>(_title: string, body: (report: (delta: { increment?: number; message?: string }) => void, signal: AbortSignal) => Promise<T>): Promise<T> => {
      const aborter = new AbortController();
      return body(() => {}, aborter.signal);
    },
  };
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
    // Preserve binary data by passing ArrayBuffer to Response
    let bodyToSend: string | undefined | ArrayBuffer;
    if (entry.body instanceof Buffer) {
      const ab = entry.body.buffer.slice(entry.body.byteOffset, entry.body.byteOffset + entry.body.byteLength);
      bodyToSend = ab as ArrayBuffer;
    } else if (typeof entry.body === 'string') {
      bodyToSend = entry.body;
    } else {
      bodyToSend = undefined;
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

import { execSync } from 'node:child_process';

function packTarball(srcDir: string, dstTar: string): void {
  execSync(`tar -czf "${dstTar}" -C "${srcDir}" .`, { stdio: 'pipe' });
}

describe('CliInstaller — extract + commit', () => {
  let storage: string;
  beforeEach(() => { storage = makeStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  it('extracts tarball, atomic-renames, writes INSTALLED_VERSION', async () => {
    // Build a real fixture tarball with a `dist/index.js` entry
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'dist/index.js'), '#!/usr/bin/env node\nconsole.log("hi")\n');
    fs.writeFileSync(path.join(srcDir, 'package.json'), JSON.stringify({ name: 'ctxloom-pro', version: '1.0.5' }));
    const tmp = path.join(storage, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const tarPath = path.join(tmp, 'fixture.tar.gz');
    packTarball(srcDir, tarPath);
    fs.rmSync(srcDir, { recursive: true });

    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    await installer.extractAndCommit('1.0.5', tarPath);

    expect(fs.existsSync(installer.installedBinaryPath('1.0.5'))).toBe(true);
    expect(fs.readFileSync(path.join(storage, 'INSTALLED_VERSION'), 'utf-8').trim()).toBe('1.0.5');
    // Tarball cleaned up
    expect(fs.existsSync(tarPath)).toBe(false);
  });

  it('deletes the previous version after a successful install of a newer one', async () => {
    // Pre-existing 1.0.4 install
    const oldDir = path.join(storage, 'ctxloom-cli', '1.0.4');
    fs.mkdirSync(path.join(oldDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'dist/index.js'), 'old');
    fs.writeFileSync(path.join(storage, 'INSTALLED_VERSION'), '1.0.4');

    // Build a fixture for 1.0.5
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'dist/index.js'), 'new');
    const tmp = path.join(storage, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const tarPath = path.join(tmp, 'fixture.tar.gz');
    packTarball(srcDir, tarPath);
    fs.rmSync(srcDir, { recursive: true });

    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    await installer.extractAndCommit('1.0.5', tarPath);

    expect(fs.existsSync(installer.installedBinaryPath('1.0.5'))).toBe(true);
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.readFileSync(path.join(storage, 'INSTALLED_VERSION'), 'utf-8').trim()).toBe('1.0.5');
  });

  it('cleans up staging dir if extraction throws', async () => {
    const tmp = path.join(storage, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const corrupt = path.join(tmp, 'corrupt.tar.gz');
    fs.writeFileSync(corrupt, 'not a real tarball');

    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    await expect(installer.extractAndCommit('1.0.5', corrupt)).rejects.toThrow();

    // No stale staging dirs left behind
    const remaining = fs.existsSync(tmp) ? fs.readdirSync(tmp) : [];
    expect(remaining.filter(f => f.startsWith('staging-'))).toEqual([]);
  });
});

describe('CliInstaller — ensureInstalled orchestration', () => {
  let storage: string;
  beforeEach(() => { storage = makeStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  function fixtureFetch(version: string): { fetch: ReturnType<typeof vi.fn>; bytes: Buffer; sha256: string } {
    // Create a real tarball to be extracted by tests
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'dist/index.js'), 'console.log("ok")');
    const tarPath = path.join(srcDir, 'fixture.tar.gz');
    packTarball(srcDir, tarPath);
    const bytes = fs.readFileSync(tarPath);
    fs.rmSync(srcDir, { recursive: true });
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    // makeFakeFetch requires the body as Buffer to survive the string conversion round-trip
    const fetch = makeFakeFetch({
      [`https://example.test/cli-v${version}/ctxloom-cli-${version}-linux-x64.tar.gz`]: { status: 200, body: bytes },
      [`https://example.test/cli-v${version}/ctxloom-cli-${version}-linux-x64.tar.gz.sha256`]: { status: 200, body: `${sha256}  x.tar.gz\n` },
    });
    return { fetch, bytes, sha256 };
  }

  it('ensureInstalled is a no-op when the version is already installed', async () => {
    const dir = path.join(storage, 'ctxloom-cli', '1.0.5', 'dist');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    const { fetch } = fixtureFetch('1.0.5');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('already-installed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ensureInstalled returns "skipped" if user picks Skip for now', async () => {
    const { fetch } = fixtureFetch('1.0.5');
    const skipPrompt = { confirmInstall: async () => 'skip' as const, alreadyDismissed: () => false };
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: skipPrompt, progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('skipped');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ensureInstalled returns "dismissed" when alreadyDismissed=true', async () => {
    const { fetch } = fixtureFetch('1.0.5');
    const dismissedPrompt = { confirmInstall: async () => 'install' as const, alreadyDismissed: () => true };
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: dismissedPrompt, progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('dismissed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ensureInstalled completes the full happy path', async () => {
    const { fetch } = fixtureFetch('1.0.5');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('installed');
    expect(installer.isInstalled('1.0.5')).toBe(true);
  });

  it('ensureInstalled cleans up stale staging dirs on entry', async () => {
    const stale = path.join(storage, 'tmp', 'staging-0.0.0');
    fs.mkdirSync(stale, { recursive: true });
    const { fetch } = fixtureFetch('1.0.5');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    await installer.ensureInstalled('1.0.5');
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('ensureInstalled stops retrying after 3 attempts in one session', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }));
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    for (let i = 0; i < 3; i++) {
      await expect(installer.ensureInstalled('1.0.5')).rejects.toThrow();
    }
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('exhausted');
  });
});
