/**
 * Tests for packages/core/src/install/installer.ts — Phase 2 of the
 * agent-harness plan. Pins the installer's behavioral contract:
 *
 *   - Creates all 5 target files on a clean install
 *   - Idempotent: re-running on a clean install is a no-op
 *   - Path-traversal safety: refuses to write outside cwd
 *   - HMAC drift: refuses to clobber hand-edited blocks without --force
 *   - Preserves user content outside the block markers
 *   - hooks.json: merges with existing entries by matcher
 *   - dry-run: returns the result struct without writing anything
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  installHarness,
  RULES_BLOCK_NAME,
  RULES_BLOCK_CONTENT,
  SESSION_START_FULL,
  extractBlock,
  verifyBlock,
} from '../packages/core/src/index.js';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-install-test-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── happy path ──────────────────────────────────────────────────────

describe('clean install', () => {
  it('creates all 5 target files', () => {
    const result = installHarness({ cwd: tmp });
    expect(result.claudeMd.created).toBe(true);
    expect(result.agentsMd.created).toBe(true);
    expect(result.geminiMd.created).toBe(true);
    expect(result.hooksJson.created).toBe(true);
    expect(result.sessionStartSh.created).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'GEMINI.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.claude/hooks.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.claude/hooks/session-start.sh'))).toBe(true);
  });

  it('CLAUDE.md/AGENTS.md/GEMINI.md all contain the same wrapped CTXLOOM-RULES block', () => {
    installHarness({ cwd: tmp });
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
      const content = fs.readFileSync(path.join(tmp, f), 'utf-8');
      const block = extractBlock(content, RULES_BLOCK_NAME);
      expect(block, `block missing in ${f}`).not.toBeNull();
      expect(block!.content).toBe(RULES_BLOCK_CONTENT);
      expect(verifyBlock(block!)).toBe(true);
    }
  });

  it('session-start.sh is written verbatim + made executable', () => {
    installHarness({ cwd: tmp });
    const filePath = path.join(tmp, '.claude/hooks/session-start.sh');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(SESSION_START_FULL);
    const stat = fs.statSync(filePath);
    // On Unix, executable bit set for user. On Windows / WSL we don't
    // assert — the installer marks the chmod failure as non-fatal.
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o100).toBe(0o100);
    }
  });

  it('hooks.json contains SessionStart + PostToolUse entries', () => {
    installHarness({ cwd: tmp });
    const hooks = JSON.parse(fs.readFileSync(path.join(tmp, '.claude/hooks.json'), 'utf-8'));
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.SessionStart[0].hooks[0].command).toContain('session-start.sh');
    expect(hooks.PostToolUse[0].matcher).toBe('Write|Edit');
    expect(hooks.PostToolUse[0].hooks[0].command).toContain('ctxloom update');
  });
});

// ─── idempotency ─────────────────────────────────────────────────────

describe('idempotency', () => {
  it('re-running with no changes reports alreadyCorrect on every file', () => {
    installHarness({ cwd: tmp });
    const second = installHarness({ cwd: tmp });
    expect(second.claudeMd.alreadyCorrect).toBe(true);
    expect(second.agentsMd.alreadyCorrect).toBe(true);
    expect(second.geminiMd.alreadyCorrect).toBe(true);
    expect(second.hooksJson.alreadyCorrect).toBe(true);
    expect(second.sessionStartSh.alreadyCorrect).toBe(true);
  });

  it('preserves user content outside the block on re-install', () => {
    const initialUserContent = '# My Project\n\nSome notes I wrote.\n\n';
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), initialUserContent, 'utf-8');
    installHarness({ cwd: tmp });
    const after = fs.readFileSync(path.join(tmp, 'CLAUDE.md'), 'utf-8');
    expect(after).toContain('# My Project');
    expect(after).toContain('Some notes I wrote.');
    expect(after).toContain('<!-- BEGIN CTXLOOM-RULES');
  });
});

// ─── HMAC drift detection ────────────────────────────────────────────

describe('HMAC drift detection', () => {
  it('refuses to clobber a hand-edited block without --force', () => {
    installHarness({ cwd: tmp });
    // Hand-edit the block content (simulating user tampering).
    const filePath = path.join(tmp, 'CLAUDE.md');
    const before = fs.readFileSync(filePath, 'utf-8');
    const tampered = before.replace(/IMPORTANT/g, 'TAMPERED');
    fs.writeFileSync(filePath, tampered, 'utf-8');

    const result = installHarness({ cwd: tmp });
    // Should NOT have rewritten the file.
    expect(result.claudeMd.alreadyCorrect).toBe(false);
    expect(result.claudeMd.updated).toBe(false);
    expect(result.warnings.some((w) => /drift/i.test(w) && /CLAUDE\.md/.test(w))).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(tampered);
  });

  it('--force overwrites tampered blocks', () => {
    installHarness({ cwd: tmp });
    const filePath = path.join(tmp, 'CLAUDE.md');
    const before = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(filePath, before.replace(/IMPORTANT/g, 'TAMPERED'), 'utf-8');

    const result = installHarness({ cwd: tmp, force: true });
    expect(result.claudeMd.updated).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).not.toContain('TAMPERED');
  });
});

// ─── path traversal safety ───────────────────────────────────────────

describe('path traversal safety', () => {
  it('throws when cwd is not a directory', () => {
    const file = path.join(tmp, 'not-a-dir');
    fs.writeFileSync(file, '', 'utf-8');
    expect(() => installHarness({ cwd: file })).toThrow(/not a directory/);
  });
});

// ─── hooks.json merge semantics ──────────────────────────────────────

describe('hooks.json merge', () => {
  it('preserves user-defined hooks on other matchers', () => {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.claude/hooks.json'),
      JSON.stringify({
        PostToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'user-bash-hook.sh' }] },
        ],
      }),
      'utf-8',
    );
    installHarness({ cwd: tmp });
    const hooks = JSON.parse(fs.readFileSync(path.join(tmp, '.claude/hooks.json'), 'utf-8'));
    // User-defined Bash hook is still there:
    const bash = hooks.PostToolUse.find((e: { matcher: string }) => e.matcher === 'Bash');
    expect(bash).toBeDefined();
    expect(bash.hooks[0].command).toBe('user-bash-hook.sh');
    // ctxloom's Write|Edit hook was added:
    const writeEdit = hooks.PostToolUse.find((e: { matcher: string }) => e.matcher === 'Write|Edit');
    expect(writeEdit).toBeDefined();
  });

  it('replaces stale ctxloom entries (by matcher + command-contains-ctxloom)', () => {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.claude/hooks.json'),
      JSON.stringify({
        PostToolUse: [
          { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'ctxloom OLD-COMMAND', timeout: 99 }] },
        ],
      }),
      'utf-8',
    );
    installHarness({ cwd: tmp });
    const hooks = JSON.parse(fs.readFileSync(path.join(tmp, '.claude/hooks.json'), 'utf-8'));
    const writeEdit = hooks.PostToolUse.filter((e: { matcher: string }) => e.matcher === 'Write|Edit');
    // Exactly one entry on this matcher (old replaced, not stacked).
    expect(writeEdit.length).toBe(1);
    expect(writeEdit[0].hooks[0].command).toContain('ctxloom update');
    expect(writeEdit[0].hooks[0].command).not.toContain('OLD-COMMAND');
  });

  it('gracefully recovers from malformed hooks.json', () => {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude/hooks.json'), '{ this is not valid json', 'utf-8');
    const result = installHarness({ cwd: tmp });
    expect(result.warnings.some((w) => /hooks\.json/.test(w))).toBe(true);
    const hooks = JSON.parse(fs.readFileSync(path.join(tmp, '.claude/hooks.json'), 'utf-8'));
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.PostToolUse).toBeDefined();
  });
});

// ─── dry-run ─────────────────────────────────────────────────────────

describe('dry-run', () => {
  it('writes no files but returns a populated result', () => {
    const result = installHarness({ cwd: tmp, dryRun: true });
    expect(result.claudeMd.dryRun).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, '.claude/hooks.json'))).toBe(false);
  });
});
