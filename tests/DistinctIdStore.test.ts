import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getOrCreateDistinctId, markAliasSent } from '@ctxloom/core';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('DistinctIdStore', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-did-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns the same id on two consecutive calls in a clean home', () => {
    const a = getOrCreateDistinctId(tmpHome);
    const b = getOrCreateDistinctId(tmpHome);
    expect(a.id).toBe(b.id);
  });

  it('creates a v4-shaped UUID', () => {
    const r = getOrCreateDistinctId(tmpHome);
    expect(r.id).toMatch(UUID_V4);
  });

  it('sets alias_pending to os.hostname() on first create', () => {
    const r = getOrCreateDistinctId(tmpHome);
    expect(r.alias_pending).toBe(os.hostname());
  });

  it('reuses existing id from disk if file already present', () => {
    const r1 = getOrCreateDistinctId(tmpHome);
    // mutate stored file: keep id, drop alias_pending
    fs.writeFileSync(path.join(tmpHome, '.ctxloom', 'distinct_id'), JSON.stringify({ id: r1.id }));
    const r2 = getOrCreateDistinctId(tmpHome);
    expect(r2.id).toBe(r1.id);
    expect(r2.alias_pending).toBeUndefined();
  });

  it('regenerates if file is corrupt/unparseable', () => {
    fs.mkdirSync(path.join(tmpHome, '.ctxloom'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.ctxloom', 'distinct_id'), 'not-json{');
    const r = getOrCreateDistinctId(tmpHome);
    expect(r.id).toMatch(UUID_V4);
  });

  it('regenerates if id is missing or not a v4 UUID', () => {
    fs.mkdirSync(path.join(tmpHome, '.ctxloom'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.ctxloom', 'distinct_id'), JSON.stringify({ id: 'not-a-uuid' }));
    const r = getOrCreateDistinctId(tmpHome);
    expect(r.id).toMatch(UUID_V4);
  });

  it('markAliasSent removes alias_pending from disk', () => {
    getOrCreateDistinctId(tmpHome);
    markAliasSent(tmpHome);
    const r = getOrCreateDistinctId(tmpHome);
    expect(r.alias_pending).toBeUndefined();
  });

  if (process.platform !== 'win32') {
    it('file permissions are 0o600 on POSIX', () => {
      getOrCreateDistinctId(tmpHome);
      const stat = fs.statSync(path.join(tmpHome, '.ctxloom', 'distinct_id'));
      expect(stat.mode & 0o777).toBe(0o600);
    });
  }
});
