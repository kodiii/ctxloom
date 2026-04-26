import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { resolveCliPath } from '../../src/client/BinaryResolver.js';

function makeTmpExtensionRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binresolver-'));
  fs.mkdirSync(path.join(dir, 'resources/ctxloom-cli/dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'resources/ctxloom-cli/dist/index.js'), '#!/usr/bin/env node\n');
  return dir;
}

describe('resolveCliPath', () => {
  let extRoot: string;
  beforeEach(() => { extRoot = makeTmpExtensionRoot(); });
  afterEach(() => { fs.rmSync(extRoot, { recursive: true, force: true }); });

  it('returns the bundled path when no override is configured', () => {
    const result = resolveCliPath({ extensionRoot: extRoot, override: null });
    expect(result.source).toBe('bundled');
    expect(result.path).toBe(path.join(extRoot, 'resources/ctxloom-cli/dist/index.js'));
    expect(result.exists).toBe(true);
  });

  it('returns the override path when configured', () => {
    const overridePath = path.join(extRoot, 'custom/ctxloom');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '');
    const result = resolveCliPath({ extensionRoot: extRoot, override: overridePath });
    expect(result.source).toBe('override');
    expect(result.path).toBe(overridePath);
    expect(result.exists).toBe(true);
  });

  it('reports exists=false when bundled CLI is missing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    const result = resolveCliPath({ extensionRoot: empty, override: null });
    expect(result.exists).toBe(false);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('reports exists=false when override points to a non-existent file', () => {
    const result = resolveCliPath({ extensionRoot: extRoot, override: '/nope/no-such-file' });
    expect(result.source).toBe('override');
    expect(result.exists).toBe(false);
  });

  it('expands ~ in override paths to the user home', () => {
    const home = os.homedir();
    const real = path.join(home, '.fake-ctxloom-test-' + Date.now());
    fs.writeFileSync(real, '');
    try {
      const result = resolveCliPath({ extensionRoot: extRoot, override: '~/' + path.basename(real) });
      expect(result.path).toBe(real);
      expect(result.exists).toBe(true);
    } finally {
      fs.unlinkSync(real);
    }
  });
});
