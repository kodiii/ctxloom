/**
 * Unit tests for RepoRegistry alias support.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RepoRegistry, validateAlias } from '../packages/core/src/tools/cross-repo-search.js';

describe('RepoRegistry alias support', () => {
  let tmpFile: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rra-'));
    tmpFile = path.join(tmpDir, 'repos.json');
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  });

  it('register without alias works as before', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb');
    const entries = reg.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].root).toBe('/abs/foo');
    expect(entries[0].alias).toBeUndefined();
  });

  it('register with alias persists alias', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    const found = reg.findByAlias('foo');
    expect(found?.root).toBe('/abs/foo');
    expect(found?.alias).toBe('foo');
  });

  it('findByAlias returns null for unknown alias', () => {
    const reg = new RepoRegistry(tmpFile);
    expect(reg.findByAlias('nope')).toBeNull();
  });

  it('findByPath returns the entry with canonical comparison', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    const found = reg.findByPath('/abs/foo');
    expect(found?.alias).toBe('foo');
  });

  it('rejects alias collision', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    expect(() =>
      reg.register('/abs/bar', '/abs/bar/.ctxloom/vectors.lancedb', { alias: 'foo' }),
    ).toThrow(/alias.*already registered/i);
  });

  it('updating same root with same alias is a no-op (idempotent)', () => {
    const reg = new RepoRegistry(tmpFile);
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    reg.register('/abs/foo', '/abs/foo/.ctxloom/vectors.lancedb', { alias: 'foo' });
    expect(reg.list()).toHaveLength(1);
  });

  it('loads existing alias-less repos.json without error', () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify([
        {
          root: '/legacy',
          dbPath: '/legacy/.ctxloom/vectors.lancedb',
          name: 'legacy',
          registeredAt: '2026-01-01T00:00:00Z',
        },
      ]),
    );
    const reg = new RepoRegistry(tmpFile);
    expect(reg.list()[0].root).toBe('/legacy');
    expect(reg.list()[0].alias).toBeUndefined();
  });
});

describe('validateAlias', () => {
  it('accepts lowercase alphanumeric + hyphen', () => {
    expect(validateAlias('contextmesh')).toEqual({ ok: true });
    expect(validateAlias('api-server')).toEqual({ ok: true });
    expect(validateAlias('proj-42-v2')).toEqual({ ok: true });
  });

  it('rejects uppercase', () => {
    expect(validateAlias('Foo').ok).toBe(false);
  });

  it('rejects underscores', () => {
    expect(validateAlias('my_proj').ok).toBe(false);
  });

  it('rejects empty', () => {
    expect(validateAlias('').ok).toBe(false);
  });

  it('rejects > 40 chars', () => {
    expect(validateAlias('a'.repeat(41)).ok).toBe(false);
  });

  it('rejects subcommand-name shadows', () => {
    for (const name of ['register', 'repos', 'setup', 'index', 'init', 'dashboard', 'status', 'trial', 'activate', 'deactivate', 'grammars', 'help']) {
      expect(validateAlias(name).ok).toBe(false);
    }
  });
});
