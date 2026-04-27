import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { resolveCliPath } from '../../src/client/BinaryResolver.js';

function makeTmpStorage(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'binresolver-'));
}

describe('resolveCliPath', () => {
  let storage: string;
  beforeEach(() => { storage = makeTmpStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  it('returns the override path when configured (regardless of existence)', () => {
    const overridePath = '/some/custom/ctxloom';
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: overridePath });
    expect(result.source).toBe('override');
    expect(result.path).toBe(overridePath);
    expect(result.exists).toBe(false);
  });

  it('expands ~ in override paths to the user home', () => {
    const home = os.homedir();
    const real = path.join(home, '.fake-ctxloom-test-' + Date.now());
    fs.writeFileSync(real, '');
    try {
      const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: '~/' + path.basename(real) });
      expect(result.source).toBe('override');
      expect(result.path).toBe(real);
      expect(result.exists).toBe(true);
    } finally {
      fs.unlinkSync(real);
    }
  });

  it('returns the globalStorage path when no override is set', () => {
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: null });
    expect(result.source).toBe('globalStorage');
    expect(result.path).toBe(path.join(storage, 'ctxloom-cli', '1.0.5', 'dist', 'index.js'));
    expect(result.exists).toBe(false);
  });

  it('reports exists=true when the versioned binary exists in globalStorage', () => {
    const installDir = path.join(storage, 'ctxloom-cli', '1.0.5', 'dist');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'index.js'), '');
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: null });
    expect(result.exists).toBe(true);
  });

  it('reports exists=false when a different version is installed', () => {
    const installDir = path.join(storage, 'ctxloom-cli', '1.0.4', 'dist');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'index.js'), '');
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: null });
    expect(result.source).toBe('globalStorage');
    expect(result.path).toBe(path.join(storage, 'ctxloom-cli', '1.0.5', 'dist', 'index.js'));
    expect(result.exists).toBe(false);
  });

  it('treats empty string override as "no override"', () => {
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: '' });
    expect(result.source).toBe('globalStorage');
  });

  it('treats whitespace-only override as "no override"', () => {
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: '   ' });
    expect(result.source).toBe('globalStorage');
  });
});
