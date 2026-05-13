/**
 * Integration-style tests for the `register --alias` CLI logic.
 *
 * These tests exercise RepoRegistry and validateAlias directly (same logic
 * the CLI dispatch calls) rather than spawning the built binary — the CLI
 * entry point is behind the license gate, so subprocess tests would require
 * a valid CTXLOOM_LICENSE_KEY in every environment. The library path gives
 * full coverage of the register + alias flow without that constraint.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RepoRegistry, validateAlias } from '../packages/core/src/tools/cross-repo-search.js';

describe('register --alias CLI logic', () => {
  let tmpHome: string;
  let registryPath: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-cli-'));
    registryPath = path.join(tmpHome, '.ctxloom', 'repos.json');
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('writes alias to registry', () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-proj-'));
    const dbPath = path.join(projDir, '.ctxloom', 'vectors.lancedb');
    try {
      const reg = new RepoRegistry(registryPath);
      reg.register(projDir, dbPath, { alias: 'myproj' });
      const entries = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      expect(entries[0].alias).toBe('myproj');
      expect(entries[0].root).toBe(projDir);
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid alias (uppercase)', () => {
    const v = validateAlias('NotValid');
    expect(v.ok).toBe(false);
    // The CLI prints: `[ctxloom] Invalid alias: ${v.reason}`
    // Verify the reason matches the pattern the test expects
    expect(v.reason).toMatch(/alias must match/i);
  });

  it('rejects alias collision', () => {
    const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-A-'));
    const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-B-'));
    try {
      const reg = new RepoRegistry(registryPath);
      reg.register(projA, path.join(projA, '.ctxloom', 'vectors.lancedb'), { alias: 'shared' });
      expect(() =>
        reg.register(projB, path.join(projB, '.ctxloom', 'vectors.lancedb'), { alias: 'shared' }),
      ).toThrow(/already registered/i);
    } finally {
      fs.rmSync(projA, { recursive: true, force: true });
      fs.rmSync(projB, { recursive: true, force: true });
    }
  });

  it('register without alias still works (no regression)', () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-proj-'));
    const dbPath = path.join(projDir, '.ctxloom', 'vectors.lancedb');
    try {
      const reg = new RepoRegistry(registryPath);
      reg.register(projDir, dbPath);
      const entries = reg.list();
      expect(entries).toHaveLength(1);
      expect(entries[0].alias).toBeUndefined();
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });
});
