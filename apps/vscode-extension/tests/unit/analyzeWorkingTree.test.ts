import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeWorkingTree } from '../../src/review/analyzeWorkingTree.js';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function initRepo(cwd: string): void {
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@test');
  git(cwd, 'config', 'user.name', 'test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

function writeAndCommit(cwd: string, filePath: string, body: string, message: string): void {
  const abs = path.join(cwd, filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  git(cwd, 'add', filePath);
  git(cwd, 'commit', '-q', '-m', message);
}

describe('analyzeWorkingTree', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-preview-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when no usable base ref exists (no remote, fresh init)', async () => {
    initRepo(tmp);
    // No commits, no remote → resolveBaseRef should bail.
    const result = await analyzeWorkingTree({ workspace: tmp });
    expect(result).toBeNull();
  });

  it('analyzes changes between main and HEAD when both branches exist locally', async () => {
    initRepo(tmp);
    writeAndCommit(tmp, 'src/foo.ts', 'export const a = 1;\n', 'init');
    git(tmp, 'checkout', '-q', '-b', 'feature');
    writeAndCommit(tmp, 'src/bar.ts', 'export const b = 2;\n', 'add bar');
    writeAndCommit(tmp, 'src/baz.ts', 'export const c = 3;\n', 'add baz');

    const result = await analyzeWorkingTree({ workspace: tmp, baseRef: 'main' });
    expect(result).not.toBeNull();
    if (result === null) return;

    expect(result.base).toBe('main');
    expect(result.changedFiles.map((f) => f.file).sort()).toEqual(['src/bar.ts', 'src/baz.ts']);
    expect(typeof result.headSha).toBe('string');
    expect(result.headSha).toMatch(/^[0-9a-f]{40}$/i);
  });

  it('reports an empty set when there are no changes vs base', async () => {
    initRepo(tmp);
    writeAndCommit(tmp, 'src/foo.ts', 'export const a = 1;\n', 'init');
    git(tmp, 'checkout', '-q', '-b', 'feature');
    // No new commits on feature.

    const result = await analyzeWorkingTree({ workspace: tmp, baseRef: 'main' });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.changedFiles).toHaveLength(0);
    expect(result.topLevel).toBeNull();
    expect(result.summary).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  it('honors an explicit baseRef that exists', async () => {
    initRepo(tmp);
    writeAndCommit(tmp, 'src/foo.ts', 'a', 'init');
    git(tmp, 'tag', 'v0.0.1');
    writeAndCommit(tmp, 'src/bar.ts', 'b', 'add bar');

    const result = await analyzeWorkingTree({ workspace: tmp, baseRef: 'v0.0.1' });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.base).toBe('v0.0.1');
    expect(result.changedFiles.map((f) => f.file)).toEqual(['src/bar.ts']);
  });

  it('returns null when the explicit baseRef does not exist', async () => {
    initRepo(tmp);
    writeAndCommit(tmp, 'src/foo.ts', 'a', 'init');
    const result = await analyzeWorkingTree({ workspace: tmp, baseRef: 'does-not-exist' });
    expect(result).toBeNull();
  });
});
