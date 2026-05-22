import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { installPrBotWorkflow } from '../src/setup/install-pr-bot.js';

function initGitRepo(cwd: string, defaultBranch = 'main'): void {
  execFileSync('git', ['init', '-q', '-b', defaultBranch], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd });
}

describe('installPrBotWorkflow', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-prbot-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses to install outside a git repository', () => {
    const result = installPrBotWorkflow({ cwd: tmp });
    expect(result.status).toBe('aborted-not-git');
    if (result.status === 'aborted-not-git') {
      expect(result.reason).toMatch(/not inside a git repository/);
    }
  });

  it('creates the workflow file at .github/workflows/ctxloom-review.yml', () => {
    initGitRepo(tmp);
    const result = installPrBotWorkflow({ cwd: tmp });
    expect(result.status).toBe('installed');
    if (result.status !== 'installed') return;

    const expected = path.join(tmp, '.github', 'workflows', 'ctxloom-review.yml');
    expect(result.path).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);

    const body = fs.readFileSync(expected, 'utf8');
    expect(body).toContain('name: ctxloom review');
    expect(body).toContain('uses: kodiii/ctxloom-pr-bot@v1');
    expect(body).toContain('fetch-depth: 0');
    expect(body).toContain('pull-requests: write');
  });

  it('records the actual default branch in the file header', () => {
    initGitRepo(tmp, 'trunk');
    const result = installPrBotWorkflow({ cwd: tmp });
    expect(result.status).toBe('installed');
    if (result.status !== 'installed') return;
    expect(result.defaultBranch).toBe('trunk');
    const body = fs.readFileSync(result.path, 'utf8');
    expect(body).toContain('Default branch for this repo: trunk');
  });

  it('honors the --ref option', () => {
    initGitRepo(tmp);
    const result = installPrBotWorkflow({ cwd: tmp, ref: 'v1.2.1' });
    expect(result.status).toBe('installed');
    if (result.status !== 'installed') return;
    const body = fs.readFileSync(result.path, 'utf8');
    expect(body).toContain('uses: kodiii/ctxloom-pr-bot@v1.2.1');
  });

  it('does not overwrite an existing workflow without --force', () => {
    initGitRepo(tmp);
    const target = path.join(tmp, '.github', 'workflows', 'ctxloom-review.yml');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'existing content');

    const result = installPrBotWorkflow({ cwd: tmp });
    expect(result.status).toBe('skipped-exists');
    expect(fs.readFileSync(target, 'utf8')).toBe('existing content');
  });

  it('overwrites an existing workflow with --force', () => {
    initGitRepo(tmp);
    const target = path.join(tmp, '.github', 'workflows', 'ctxloom-review.yml');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'existing content');

    const result = installPrBotWorkflow({ cwd: tmp, force: true });
    expect(result.status).toBe('installed');
    expect(fs.readFileSync(target, 'utf8')).toContain('ctxloom review');
  });

  it('creates .github/workflows/ if it does not already exist', () => {
    initGitRepo(tmp);
    expect(fs.existsSync(path.join(tmp, '.github'))).toBe(false);
    const result = installPrBotWorkflow({ cwd: tmp });
    expect(result.status).toBe('installed');
    expect(fs.existsSync(path.join(tmp, '.github', 'workflows'))).toBe(true);
  });
});
