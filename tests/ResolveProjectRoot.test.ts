/**
 * Unit tests for resolveProjectRoot.
 *
 * The resolver picks a project root from (in priority order):
 *   1. Explicit `arg` — alias-only if no path separator, else path
 *   2. `env.CTXLOOM_ROOT`
 *   3. `cwd`
 *
 * Plus `validateDefaultRoot(candidate)` which checks that the chosen
 * candidate is safe to pin as the default (not `/`, exists, has a project
 * marker file).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveProjectRoot, validateDefaultRoot } from '../packages/core/src/server/resolveProjectRoot.js';

interface MockRegistry {
  findByAlias(name: string): { root: string; alias?: string } | null;
  list(): { root: string; alias?: string }[];
}

function mkRegistry(entries: { root: string; alias?: string }[]): MockRegistry {
  return {
    findByAlias: (name) => entries.find((e) => e.alias === name) ?? null,
    list: () => entries,
  };
}

describe('resolveProjectRoot', () => {
  it('explicit alias (no separator) → registry path', () => {
    const reg = mkRegistry([{ root: '/abs/foo', alias: 'foo' }]);
    const out = resolveProjectRoot({
      arg: 'foo',
      env: undefined,
      cwd: '/cwd',
      registry: reg,
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.root).toBe('/abs/foo');
      expect(out.alias).toBe('foo');
      expect(out.source).toBe('arg-alias');
    }
  });

  it('explicit alias-shaped string with no matching alias → error (does NOT fall through to path)', () => {
    const reg = mkRegistry([{ root: '/abs/foo', alias: 'foo' }]);
    const out = resolveProjectRoot({
      arg: 'bar',
      env: undefined,
      cwd: '/cwd',
      registry: reg,
    });
    expect(out.kind).toBe('alias_not_found');
    if (out.kind === 'alias_not_found') {
      expect(out.alias).toBe('bar');
      expect(out.didYouMean).toEqual(['foo']);
    }
  });

  it('explicit path (has separator) → resolves to absolute', () => {
    const reg = mkRegistry([]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-'));
    try {
      const out = resolveProjectRoot({
        arg: tmpDir,
        env: undefined,
        cwd: '/cwd',
        registry: reg,
      });
      expect(out.kind).toBe('ok');
      if (out.kind === 'ok') {
        expect(out.root).toBe(fs.realpathSync(tmpDir));
        expect(out.source).toBe('arg-path');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('arg omitted, env set → use env', () => {
    const reg = mkRegistry([]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-'));
    try {
      const out = resolveProjectRoot({
        arg: undefined,
        env: tmpDir,
        cwd: '/cwd',
        registry: reg,
      });
      expect(out.kind).toBe('ok');
      if (out.kind === 'ok') {
        expect(out.root).toBe(fs.realpathSync(tmpDir));
        expect(out.source).toBe('env');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('arg + env both unset → use cwd', () => {
    const reg = mkRegistry([]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-'));
    try {
      const out = resolveProjectRoot({
        arg: undefined,
        env: undefined,
        cwd: tmpDir,
        registry: reg,
      });
      expect(out.kind).toBe('ok');
      if (out.kind === 'ok') {
        expect(out.root).toBe(fs.realpathSync(tmpDir));
        expect(out.source).toBe('cwd');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("path doesn't exist → project_root_not_found", () => {
    const reg = mkRegistry([]);
    const out = resolveProjectRoot({
      arg: '/nonexistent/path/xyzzy',
      env: undefined,
      cwd: '/cwd',
      registry: reg,
    });
    expect(out.kind).toBe('project_root_not_found');
  });
});

describe('validateDefaultRoot', () => {
  it('rejects filesystem root', () => {
    expect(validateDefaultRoot('/')).toBe(false);
  });

  it('rejects nonexistent', () => {
    expect(validateDefaultRoot('/nonexistent/xyzzy')).toBe(false);
  });

  it('rejects directory without project marker', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-novalid-'));
    try {
      expect(validateDefaultRoot(tmpDir)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts directory with .git', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-git-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));
    try {
      expect(validateDefaultRoot(tmpDir)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts directory with .ctxloom', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-ctx-'));
    fs.mkdirSync(path.join(tmpDir, '.ctxloom'));
    try {
      expect(validateDefaultRoot(tmpDir)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts directory with package.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpr-pkg-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    try {
      expect(validateDefaultRoot(tmpDir)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
