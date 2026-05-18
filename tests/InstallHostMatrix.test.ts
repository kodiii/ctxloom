/**
 * Tests for the Phase 4d cross-agent host matrix. Pins:
 *
 *   - HOST_ADAPTERS list is populated + every adapter has unique id/path
 *   - `getHostAdapter` returns the right adapter by id
 *   - --host=cursor writes .cursorrules (only, by default)
 *   - --host=all expands to every adapter
 *   - --host=unknown is dropped with a warning, NOT a hard failure
 *   - Each adapter is idempotent (rewriting unchanged content reports
 *     alreadyCorrect)
 *   - Path-traversal safety still applies to host adapters
 *   - Existing Claude/AGENTS/Gemini files still written when extraHosts
 *     is omitted (back-compat)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  installHarness,
  HOST_ADAPTERS,
  getHostAdapter,
  SUPPORTED_HOST_IDS,
} from '../packages/core/src/index.js';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-host-test-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── adapter registry shape ──────────────────────────────────────────

describe('HOST_ADAPTERS registry', () => {
  it('has at least 4 adapters (cursor, aider, copilot, windsurf)', () => {
    const ids = new Set(HOST_ADAPTERS.map((a) => a.id));
    expect(ids.has('cursor')).toBe(true);
    expect(ids.has('aider')).toBe(true);
    expect(ids.has('copilot')).toBe(true);
    expect(ids.has('windsurf')).toBe(true);
  });

  it('every adapter has a unique id', () => {
    const ids = HOST_ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every adapter has a unique path', () => {
    const paths = HOST_ADAPTERS.map((a) => a.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('SUPPORTED_HOST_IDS matches HOST_ADAPTERS ids', () => {
    const ids = HOST_ADAPTERS.map((a) => a.id);
    expect(SUPPORTED_HOST_IDS).toEqual(ids);
  });

  it('getHostAdapter returns undefined for unknown ids', () => {
    expect(getHostAdapter('nope')).toBeUndefined();
  });

  it.each(['cursor', 'aider', 'copilot', 'windsurf'])(
    'getHostAdapter("%s") returns a populated adapter',
    (id) => {
      const a = getHostAdapter(id);
      expect(a).toBeDefined();
      expect(a!.id).toBe(id);
      expect(a!.path.length).toBeGreaterThan(0);
      expect(typeof a!.render).toBe('function');
      expect(a!.render().length).toBeGreaterThan(0);
    },
  );
});

// ─── default (no --host flag) — back-compat ──────────────────────────

describe('default install (no --host flag)', () => {
  it('writes Claude/AGENTS/Gemini but NOT cursor/aider/copilot/windsurf', () => {
    installHarness({ cwd: tmp });
    expect(fs.existsSync(path.join(tmp, 'CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'GEMINI.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.cursorrules'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'CONVENTIONS.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, '.github/copilot-instructions.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, '.windsurfrules'))).toBe(false);
  });

  it('extraHosts array empty in result struct', () => {
    const r = installHarness({ cwd: tmp });
    expect(r.extraHosts).toEqual([]);
  });
});

// ─── --host=<id> targeted opt-in ─────────────────────────────────────

describe('--host=<id> opt-in', () => {
  it('--host=cursor writes only .cursorrules (no other extras)', () => {
    const r = installHarness({ cwd: tmp, extraHosts: ['cursor'] });
    expect(fs.existsSync(path.join(tmp, '.cursorrules'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'CONVENTIONS.md'))).toBe(false);
    expect(r.extraHosts.length).toBe(1);
    expect(r.extraHosts[0].hostId).toBe('cursor');
    expect(r.extraHosts[0].created).toBe(true);
  });

  it('--host=cursor,aider writes both', () => {
    const r = installHarness({ cwd: tmp, extraHosts: ['cursor', 'aider'] });
    expect(fs.existsSync(path.join(tmp, '.cursorrules'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'CONVENTIONS.md'))).toBe(true);
    expect(r.extraHosts.length).toBe(2);
    const hostIds = r.extraHosts.map((h) => h.hostId).sort();
    expect(hostIds).toEqual(['aider', 'cursor']);
  });

  it('--host=copilot creates .github/ dir if missing', () => {
    installHarness({ cwd: tmp, extraHosts: ['copilot'] });
    expect(fs.existsSync(path.join(tmp, '.github'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.github/copilot-instructions.md'))).toBe(true);
  });

  it('--host=all expands to every adapter', () => {
    const r = installHarness({ cwd: tmp, extraHosts: ['all'] });
    expect(r.extraHosts.length).toBe(HOST_ADAPTERS.length);
    for (const adapter of HOST_ADAPTERS) {
      expect(fs.existsSync(path.join(tmp, adapter.path))).toBe(true);
    }
  });

  it('deduplicates repeated --host ids', () => {
    const r = installHarness({ cwd: tmp, extraHosts: ['cursor', 'cursor', 'cursor'] });
    expect(r.extraHosts.length).toBe(1);
  });

  it('rejects unknown host ids with a warning, NOT a throw', () => {
    const r = installHarness({ cwd: tmp, extraHosts: ['fake-agent', 'cursor'] });
    expect(r.warnings.some((w) => /fake-agent/.test(w))).toBe(true);
    // Valid host still written.
    expect(fs.existsSync(path.join(tmp, '.cursorrules'))).toBe(true);
  });
});

// ─── idempotency ─────────────────────────────────────────────────────

describe('idempotency', () => {
  it('re-running with the same hosts reports alreadyCorrect', () => {
    installHarness({ cwd: tmp, extraHosts: ['cursor', 'aider'] });
    const second = installHarness({ cwd: tmp, extraHosts: ['cursor', 'aider'] });
    for (const hr of second.extraHosts) {
      expect(hr.alreadyCorrect).toBe(true);
    }
  });

  it('rewrites a tampered host file back to canonical', () => {
    installHarness({ cwd: tmp, extraHosts: ['cursor'] });
    const target = path.join(tmp, '.cursorrules');
    fs.writeFileSync(target, '# hand-edited content\n', 'utf-8');
    const r = installHarness({ cwd: tmp, extraHosts: ['cursor'] });
    expect(r.extraHosts[0].updated).toBe(true);
    const content = fs.readFileSync(target, 'utf-8');
    expect(content).not.toContain('hand-edited');
    expect(content).toContain('ctxloom');
  });
});

// ─── dry-run ─────────────────────────────────────────────────────────

describe('dry-run', () => {
  it('writes no host files when dryRun=true', () => {
    const r = installHarness({ cwd: tmp, extraHosts: ['cursor', 'aider'], dryRun: true });
    expect(r.extraHosts.length).toBe(2);
    for (const hr of r.extraHosts) {
      expect(hr.dryRun).toBe(true);
    }
    expect(fs.existsSync(path.join(tmp, '.cursorrules'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'CONVENTIONS.md'))).toBe(false);
  });
});

// ─── path safety ─────────────────────────────────────────────────────

describe('path traversal safety', () => {
  it('every adapter path resolves inside the project root', () => {
    installHarness({ cwd: tmp, extraHosts: ['all'] });
    const tmpResolved = path.resolve(tmp);
    for (const adapter of HOST_ADAPTERS) {
      const absolute = path.resolve(tmp, adapter.path);
      expect(absolute.startsWith(tmpResolved)).toBe(true);
    }
  });
});

// ─── content shape ───────────────────────────────────────────────────

describe('rendered host content includes ctxloom guidance', () => {
  it.each(HOST_ADAPTERS.map((a) => [a.id, a] as const))(
    '%s — rendered content mentions ctx_get_minimal_context (the orientation anchor)',
    (_id, adapter) => {
      const content = adapter.render();
      expect(content).toMatch(/ctx_get_minimal_context/);
    },
  );

  it.each(HOST_ADAPTERS.map((a) => [a.id, a] as const))(
    '%s — rendered content has a generated-by header',
    (_id, adapter) => {
      const content = adapter.render();
      expect(content).toMatch(/ctxloom init/);
    },
  );
});
