/**
 * Tests for `ctxloom init` — the per-project bootstrap that drops
 * .mcp.json + .gitignore so the MCP server pins to the right project
 * root automatically.
 *
 * Each test runs against a fresh temp directory (Node's mkdtempSync)
 * so we never touch the user's repo. We don't shell out to the CLI —
 * we exercise the public function `runInit` directly, which is what
 * the CLI dispatch in src/index.ts also calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInit, buildCtxloomEntry } from '../src/setup/init.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-init-test-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('buildCtxloomEntry', () => {
  it('produces an entry with CTXLOOM_ROOT pinned to the given path', () => {
    const entry = buildCtxloomEntry('/some/project');
    expect(entry).toEqual({
      command: 'ctxloom',
      args: [],
      env: { CTXLOOM_ROOT: '/some/project' },
    });
  });
});

describe('runInit — fresh project', () => {
  it('creates .mcp.json with the ctxloom server pinned to cwd', () => {
    const result = runInit(tmp);

    expect(result.mcpJson.created).toBe(true);
    expect(result.mcpJson.merged).toBe(false);
    expect(result.mcpJson.alreadyCorrect).toBe(false);

    const written = JSON.parse(fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf-8'));
    expect(written).toEqual({
      mcpServers: {
        ctxloom: {
          command: 'ctxloom',
          args: [],
          env: { CTXLOOM_ROOT: tmp },
        },
      },
    });
  });

  it('creates .gitignore containing .ctxloom/ when none exists', () => {
    const result = runInit(tmp);

    expect(result.gitignore.created).toBe(true);
    expect(result.gitignore.appended).toBe(true);
    expect(result.gitignore.alreadyPresent).toBe(false);

    const gi = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8');
    expect(gi).toContain('.ctxloom/');
  });

  it('emits a warning when cwd is not a git repo', () => {
    const result = runInit(tmp);
    expect(result.warnings.some((w) => /\.git directory/.test(w))).toBe(true);
  });

  it('does not emit the no-git warning when .git is present', () => {
    fs.mkdirSync(path.join(tmp, '.git'));
    const result = runInit(tmp);
    expect(result.warnings.some((w) => /\.git directory/.test(w))).toBe(false);
  });

  it('throws when cwd is not a directory', () => {
    const file = path.join(tmp, 'not-a-dir.txt');
    fs.writeFileSync(file, 'hi', 'utf-8');
    expect(() => runInit(file)).toThrow(/not a directory/);
  });
});

describe('runInit — .mcp.json merge', () => {
  it('merges into an existing .mcp.json without clobbering other servers', () => {
    const existing = {
      mcpServers: {
        other: { command: 'other-mcp', args: ['--foo'] },
      },
      // Top-level keys other than mcpServers must survive too.
      $schema: 'https://example.com/mcp.schema.json',
    };
    fs.writeFileSync(
      path.join(tmp, '.mcp.json'),
      JSON.stringify(existing, null, 2),
      'utf-8',
    );

    const result = runInit(tmp);
    expect(result.mcpJson.created).toBe(false);
    expect(result.mcpJson.merged).toBe(true);

    const written = JSON.parse(fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf-8'));
    expect(written.mcpServers.other).toEqual({ command: 'other-mcp', args: ['--foo'] });
    expect(written.mcpServers.ctxloom.env.CTXLOOM_ROOT).toBe(tmp);
    expect(written.$schema).toBe('https://example.com/mcp.schema.json');
  });

  it('rewrites a stale ctxloom entry that points at a different CTXLOOM_ROOT', () => {
    const existing = {
      mcpServers: {
        ctxloom: { command: 'ctxloom', args: [], env: { CTXLOOM_ROOT: '/wrong/path' } },
      },
    };
    fs.writeFileSync(
      path.join(tmp, '.mcp.json'),
      JSON.stringify(existing, null, 2),
      'utf-8',
    );

    const result = runInit(tmp);
    expect(result.mcpJson.merged).toBe(true);
    expect(result.mcpJson.alreadyCorrect).toBe(false);

    const written = JSON.parse(fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf-8'));
    expect(written.mcpServers.ctxloom.env.CTXLOOM_ROOT).toBe(tmp);
  });

  it('is a no-op when ctxloom is already pinned to this exact root', () => {
    runInit(tmp); // first pass: create
    const before = fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf-8');
    const result = runInit(tmp); // second pass: should be no-op
    const after = fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf-8');

    expect(result.mcpJson.created).toBe(false);
    expect(result.mcpJson.merged).toBe(false);
    expect(result.mcpJson.alreadyCorrect).toBe(true);
    expect(after).toBe(before);
  });

  it('throws a clear error when the existing .mcp.json is malformed', () => {
    fs.writeFileSync(path.join(tmp, '.mcp.json'), '{ not json', 'utf-8');
    expect(() => runInit(tmp)).toThrow(/not valid JSON/);
  });

  it('initialises mcpServers when the existing file lacks the key', () => {
    fs.writeFileSync(
      path.join(tmp, '.mcp.json'),
      JSON.stringify({ $schema: 'https://example.com/mcp.schema.json' }, null, 2),
      'utf-8',
    );
    const result = runInit(tmp);
    expect(result.mcpJson.merged).toBe(true);
    const written = JSON.parse(fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf-8'));
    expect(written.mcpServers.ctxloom.env.CTXLOOM_ROOT).toBe(tmp);
  });
});

describe('runInit — .gitignore append', () => {
  it('appends .ctxloom/ to an existing .gitignore that lacks it', () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n.next\n', 'utf-8');
    const result = runInit(tmp);

    expect(result.gitignore.created).toBe(false);
    expect(result.gitignore.appended).toBe(true);
    expect(result.gitignore.alreadyPresent).toBe(false);

    const gi = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8');
    // Existing entries preserved
    expect(gi).toContain('node_modules\n');
    expect(gi).toContain('.next\n');
    // New entry present
    expect(gi).toContain('.ctxloom/');
  });

  it('does not append when .ctxloom/ is already present', () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n.ctxloom/\n', 'utf-8');
    const result = runInit(tmp);

    expect(result.gitignore.alreadyPresent).toBe(true);
    expect(result.gitignore.appended).toBe(false);

    const gi = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8');
    // No duplicate
    const occurrences = gi.match(/^\.ctxloom\/?$/gm) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('treats bare .ctxloom (no slash) as already present', () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), '.ctxloom\n', 'utf-8');
    const result = runInit(tmp);
    expect(result.gitignore.alreadyPresent).toBe(true);
  });

  it('treats commented-out .ctxloom as NOT present (so it gets appended)', () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), '# .ctxloom/\n', 'utf-8');
    const result = runInit(tmp);
    expect(result.gitignore.alreadyPresent).toBe(false);
    expect(result.gitignore.appended).toBe(true);
  });

  it('inserts a newline separator when the existing file does not end in one', () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules', 'utf-8'); // no trailing \n
    runInit(tmp);
    const gi = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8');
    // Must not produce "node_modules# ctxloom local index..."
    expect(gi).not.toMatch(/node_modules#/);
    expect(gi).toMatch(/node_modules\n/);
  });
});

describe('runInit — idempotency', () => {
  it('produces the same on-disk result on repeated runs', () => {
    runInit(tmp);
    runInit(tmp);
    const result = runInit(tmp);

    expect(result.mcpJson.alreadyCorrect).toBe(true);
    expect(result.gitignore.alreadyPresent).toBe(true);

    const gi = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf-8');
    const occurrences = gi.match(/^\.ctxloom\/?$/gm) ?? [];
    expect(occurrences.length).toBe(1);
  });
});
