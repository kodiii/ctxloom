import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  shouldEmitInstallCompleted,
  shouldEmitFirstReviewRun,
} from '@ctxloom/core';

describe('shouldEmitInstallCompleted', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-install-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns true on first call (no marker present)', () => {
    expect(shouldEmitInstallCompleted(tmpHome)).toBe(true);
  });

  it('writes the marker file after the first call', () => {
    shouldEmitInstallCompleted(tmpHome);
    const marker = path.join(tmpHome, '.ctxloom', 'installed_at');
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('marker file has mode 0o600 (unix only)', () => {
    if (process.platform === 'win32') return;
    shouldEmitInstallCompleted(tmpHome);
    const marker = path.join(tmpHome, '.ctxloom', 'installed_at');
    const stat = fs.statSync(marker);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('returns false on subsequent calls', () => {
    shouldEmitInstallCompleted(tmpHome);
    expect(shouldEmitInstallCompleted(tmpHome)).toBe(false);
    expect(shouldEmitInstallCompleted(tmpHome)).toBe(false);
  });

  it('marker contents are an ISO timestamp', () => {
    shouldEmitInstallCompleted(tmpHome);
    const marker = path.join(tmpHome, '.ctxloom', 'installed_at');
    const contents = fs.readFileSync(marker, 'utf8');
    expect(() => new Date(contents).toISOString()).not.toThrow();
    expect(new Date(contents).getTime()).toBeGreaterThan(0);
  });

  it('returns true on write failure (best-effort: prefer over-firing to never firing)', () => {
    // Make the parent dir read-only so mkdir/writeFile fails. POSIX-only.
    if (process.platform === 'win32') return;
    fs.chmodSync(tmpHome, 0o500);
    try {
      // Still returns true — better to nag once extra than miss the install
      expect(shouldEmitInstallCompleted(tmpHome)).toBe(true);
    } finally {
      fs.chmodSync(tmpHome, 0o700);
    }
  });
});

describe('shouldEmitFirstReviewRun', () => {
  let tmpProject: string;

  beforeEach(() => {
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-firstreview-'));
  });

  afterEach(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  it('returns true on first call for a project', () => {
    expect(shouldEmitFirstReviewRun(tmpProject)).toBe(true);
  });

  it('writes the marker inside the project .ctxloom dir', () => {
    shouldEmitFirstReviewRun(tmpProject);
    const marker = path.join(tmpProject, '.ctxloom', 'first_review_at');
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('returns false on subsequent calls for the same project', () => {
    shouldEmitFirstReviewRun(tmpProject);
    expect(shouldEmitFirstReviewRun(tmpProject)).toBe(false);
  });

  it('is project-scoped — separate projects each fire once', () => {
    const tmpProject2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-firstreview-'));
    try {
      expect(shouldEmitFirstReviewRun(tmpProject)).toBe(true);
      expect(shouldEmitFirstReviewRun(tmpProject2)).toBe(true);
      expect(shouldEmitFirstReviewRun(tmpProject)).toBe(false);
      expect(shouldEmitFirstReviewRun(tmpProject2)).toBe(false);
    } finally {
      fs.rmSync(tmpProject2, { recursive: true, force: true });
    }
  });

  it('marker file has mode 0o600 (unix only)', () => {
    if (process.platform === 'win32') return;
    shouldEmitFirstReviewRun(tmpProject);
    const marker = path.join(tmpProject, '.ctxloom', 'first_review_at');
    const stat = fs.statSync(marker);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
