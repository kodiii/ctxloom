/**
 * Tests for the disk sink + reader in
 * packages/core/src/budget/eventCollector.ts.
 *
 * Privacy contract pinned: events on disk contain ONLY event type +
 * tool name + token counts. Source content, file paths, query
 * strings, and user identifiers must never appear. The first
 * describe block pins that invariant via a fixture-emit-and-readback
 * round trip — a regression that smuggled source content through
 * via `event` payload extension would surface here.
 *
 * Crash isolation pinned: writes that fail (perm denied, ENOENT
 * parent, disk full simulated via invalid path) must NEVER throw —
 * telemetry is observability, not correctness.
 *
 * Window/file rotation pinned: a 14-day window crossing day
 * boundaries reads the right files; events outside the window are
 * filtered even when their file is opened.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendEvent,
  readEvents,
  telemetryDir,
  filenameForDate,
  __resetTelemetryWarnFlagsForTests,
  type PersistedEvent,
} from '../src/budget/eventCollector.js';
import { logger } from '../packages/core/src/utils/logger.js';
import { vi } from 'vitest';

const ORIGINAL_DIR_ENV = process.env.CTXLOOM_TELEMETRY_DIR;

let testDir: string;
beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-telemetry-test-'));
  process.env.CTXLOOM_TELEMETRY_DIR = testDir;
});
afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  if (ORIGINAL_DIR_ENV === undefined) delete process.env.CTXLOOM_TELEMETRY_DIR;
  else process.env.CTXLOOM_TELEMETRY_DIR = ORIGINAL_DIR_ENV;
});

describe('telemetryDir + filenameForDate', () => {
  it('telemetryDir honors CTXLOOM_TELEMETRY_DIR override', () => {
    expect(telemetryDir()).toBe(testDir);
  });

  it('telemetryDir falls back to ~/.ctxloom/telemetry when env unset', () => {
    delete process.env.CTXLOOM_TELEMETRY_DIR;
    expect(telemetryDir()).toBe(path.join(os.homedir(), '.ctxloom', 'telemetry'));
  });

  it.each([
    ['2026-05-18T00:00:00Z', 'budget-events-2026-05-18.jsonl'],
    ['2026-01-05T23:59:59Z', 'budget-events-2026-01-05.jsonl'],
    ['2026-12-31T12:00:00Z', 'budget-events-2026-12-31.jsonl'],
  ])('filenameForDate(%s) → %s', (iso, expected) => {
    expect(filenameForDate(new Date(iso))).toBe(expected);
  });

  it('UTC-stable: a date at midnight UTC writes to the UTC-day file regardless of local TZ', () => {
    // 23:30 in some local TZs would otherwise produce a different
    // "day" name; filenameForDate uses getUTCDate explicitly.
    const d = new Date('2026-05-18T00:30:00Z');
    expect(filenameForDate(d)).toBe('budget-events-2026-05-18.jsonl');
  });
});

describe('appendEvent + readEvents round-trip', () => {
  it('writes one JSONL line per appended event and reads them back', () => {
    const now = new Date('2026-05-18T12:00:00Z');
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 8500, budget: 8000, ratio: 1.0625 }, now);
    appendEvent({ event: 'mcp.fallback.used', tool: 'ctx_get_file', fallback_reason: 'budget_exceeded', mode: 'skeleton' }, now);

    const events = readEvents({ since: new Date('2026-05-18T00:00:00Z'), until: new Date('2026-05-18T23:59:59Z') });
    expect(events.length).toBe(2);
    expect(events[0].event).toBe('mcp.budget.exceeded');
    expect(events[0].tool).toBe('ctx_get_file');
    expect(events[0].original_tokens).toBe(8500);
    expect(events[0].ts).toBe('2026-05-18T12:00:00.000Z');
    expect(events[1].event).toBe('mcp.fallback.used');
    expect(events[1].mode).toBe('skeleton');
  });

  it('round-trip preserves the privacy contract — no source content fields leak through', () => {
    // The persisted shape allows arbitrary extension via the
    // Record<string, unknown> bag, but the event SHAPE we emit is
    // strictly token/mode/tool. This test pins that contract for the
    // canonical events: if someone adds a `source` or `path` field
    // to a future event shape (regression), the privacy invariant
    // assertion below catches it.
    const now = new Date('2026-05-18T12:00:00Z');
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 8500, budget: 8000, ratio: 1.0625 }, now);
    const events = readEvents();
    const FORBIDDEN_FIELDS = ['source', 'path', 'content', 'query', 'body', 'user', 'email', 'license_key'];
    for (const e of events) {
      for (const field of FORBIDDEN_FIELDS) {
        expect(
          e[field],
          `Privacy regression: persisted event contains forbidden field '${field}'. Events must never carry source content / file paths / user identifiers.`,
        ).toBeUndefined();
      }
    }
  });
});

describe('appendEvent crash isolation', () => {
  it('does not throw when the destination directory is unwritable', () => {
    // Point at a path that mkdirSync recursive cannot create
    // (a regular file as a parent component).
    const blockerFile = path.join(testDir, 'blocker');
    fs.writeFileSync(blockerFile, 'i am a file, not a directory');
    process.env.CTXLOOM_TELEMETRY_DIR = path.join(blockerFile, 'inside');

    // Must not throw — the request that fired the event must keep
    // running even if persistence is broken.
    expect(() => {
      appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' });
    }).not.toThrow();
  });
});

describe('readEvents window + filter behavior', () => {
  it('filters out events earlier than `since`', () => {
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, new Date('2026-05-10T12:00:00Z'));
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, new Date('2026-05-15T12:00:00Z'));
    const events = readEvents({ since: new Date('2026-05-14T00:00:00Z'), until: new Date('2026-05-20T00:00:00Z') });
    expect(events.length).toBe(1);
    expect(events[0].ts).toBe('2026-05-15T12:00:00.000Z');
  });

  it('filters out events later than `until`', () => {
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, new Date('2026-05-10T12:00:00Z'));
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, new Date('2026-05-15T12:00:00Z'));
    const events = readEvents({ since: new Date('2026-05-09T00:00:00Z'), until: new Date('2026-05-11T00:00:00Z') });
    expect(events.length).toBe(1);
    expect(events[0].ts).toBe('2026-05-10T12:00:00.000Z');
  });

  it('walks across day boundaries correctly (multi-file window)', () => {
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, new Date('2026-05-10T12:00:00Z'));
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, new Date('2026-05-15T12:00:00Z'));
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, new Date('2026-05-18T12:00:00Z'));
    const events = readEvents({ since: new Date('2026-05-09T00:00:00Z'), until: new Date('2026-05-20T00:00:00Z') });
    expect(events.length).toBe(3);
  });

  it('--tool filter drops non-matching events', () => {
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, new Date('2026-05-18T12:00:00Z'));
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_search' }, new Date('2026-05-18T12:00:00Z'));
    const events = readEvents({ tool: 'ctx_search', since: new Date('2026-05-18T00:00:00Z'), until: new Date('2026-05-18T23:59:59Z') });
    expect(events.length).toBe(1);
    expect(events[0].tool).toBe('ctx_search');
  });

  it('returns empty array when telemetry dir does not exist', () => {
    process.env.CTXLOOM_TELEMETRY_DIR = path.join(testDir, 'never-created');
    expect(readEvents()).toEqual([]);
  });

  it('skips malformed lines silently (truncated crash-mid-write)', () => {
    // Pre-seed a file with one valid line + one truncated line.
    const file = path.join(testDir, filenameForDate(new Date('2026-05-18T12:00:00Z')));
    fs.writeFileSync(
      file,
      JSON.stringify({ ts: '2026-05-18T12:00:00.000Z', event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }) + '\n' +
        '{ "ts": "2026-05-18", "event": "trunca' + '\n',
    );
    const events = readEvents({ since: new Date('2026-05-18T00:00:00Z'), until: new Date('2026-05-18T23:59:59Z') });
    expect(events.length).toBe(1);
    expect(events[0].tool).toBe('ctx_get_file');
  });

  it('skips lines that parse as JSON but lack required fields', () => {
    const file = path.join(testDir, filenameForDate(new Date('2026-05-18T12:00:00Z')));
    fs.writeFileSync(
      file,
      JSON.stringify({ ts: '2026-05-18T12:00:00.000Z', event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }) + '\n' +
        JSON.stringify({ event: 'missing_ts_and_tool' }) + '\n' +
        JSON.stringify({ ts: '2026-05-18T12:00:00.000Z' }) + '\n', // missing event + tool
    );
    const events = readEvents({ since: new Date('2026-05-18T00:00:00Z'), until: new Date('2026-05-18T23:59:59Z') });
    expect(events.length).toBe(1);
  });
});

describe('default window', () => {
  it('readEvents() with no `since` defaults to 14 days back from now', () => {
    const now = new Date();
    const within = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);  // 7 days ago — in window
    const outside = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago — outside
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, within);
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, outside);
    const events = readEvents();
    expect(events.length).toBe(1);
    expect(new Date(events[0].ts).getTime()).toBeGreaterThan(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  });
});

describe('type narrow: PersistedEvent', () => {
  it('appendEvent enriches input with ts; readEvents returns PersistedEvent', () => {
    const now = new Date('2026-05-18T12:00:00Z');
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }, now);
    const events: PersistedEvent[] = readEvents({ since: new Date('2026-05-18T00:00:00Z'), until: new Date('2026-05-18T23:59:59Z') });
    expect(events[0].ts).toBe('2026-05-18T12:00:00.000Z');
  });
});

// ─── #142: CTXLOOM_TELEMETRY_DIR sanitization ─────────────────────────

describe('telemetryDir sanitization (#142)', () => {
  beforeEach(() => {
    __resetTelemetryWarnFlagsForTests();
  });

  it('rejects paths containing ".." and falls back to default', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    process.env.CTXLOOM_TELEMETRY_DIR = '/tmp/../etc/foo';
    const resolved = telemetryDir();
    expect(resolved).toBe(path.join(os.homedir(), '.ctxloom', 'telemetry'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/rejected/i);
    warn.mockRestore();
  });

  it('rejects non-absolute relative paths and falls back to default', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    process.env.CTXLOOM_TELEMETRY_DIR = 'some/relative/path';
    const resolved = telemetryDir();
    // A relative env value is rejected (path.isAbsolute on the raw
    // value is false). Sanity: fallback is the home default.
    expect(resolved).toBe(path.join(os.homedir(), '.ctxloom', 'telemetry'));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('accepts a clean absolute path verbatim (resolved form)', () => {
    // testDir is set by the outer beforeEach to an mkdtempSync result
    // — already absolute, no traversal segments. Should resolve and
    // be returned unchanged.
    expect(telemetryDir()).toBe(path.resolve(testDir));
  });

  it('warns at most once across many rejections in the same process (once-flag)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    process.env.CTXLOOM_TELEMETRY_DIR = '/tmp/../bad';
    telemetryDir();
    telemetryDir();
    telemetryDir();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// ─── #143: appendEvent once-flag warn on failure ──────────────────────

describe('appendEvent failure surfacing (#143)', () => {
  beforeEach(() => {
    __resetTelemetryWarnFlagsForTests();
  });

  it('emits exactly one logger.warn on the first appendFileSync failure', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' });
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' });
    appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' });

    // First failure → warn. Subsequent failures → silent.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/telemetry sink append failed/);
    // Error message surfaces for operator triage.
    const warnContext = warn.mock.calls[0][1] as { error: string };
    expect(warnContext.error).toMatch(/EACCES/);

    spy.mockRestore();
    warn.mockRestore();
  });

  it('does not throw or propagate when appendFileSync fails', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    // Pre-existing crash-isolation contract: telemetry MUST NEVER
    // take down the MCP server. The new logger.warn must not break
    // this invariant.
    expect(() => {
      appendEvent({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file' });
    }).not.toThrow();

    spy.mockRestore();
    warn.mockRestore();
  });
});

// ─── #144: NaN-date boundary filter ───────────────────────────────────

describe('readEvents NaN-date handling (#144)', () => {
  it('drops events with malformed timestamps from boundary filter', () => {
    const now = new Date('2026-05-18T12:00:00Z');
    // Seed today's file with both a valid event and a malformed one
    // (truncated mid-write, manually edited, etc).
    const file = path.join(testDir, filenameForDate(now));
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ ts: '2026-05-18T12:00:00.000Z', event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }),
        JSON.stringify({ ts: 'not-a-date', event: 'mcp.budget.exceeded', tool: 'ctx_get_file' }),
        JSON.stringify({ ts: 'also-bogus-2026-13-99', event: 'mcp.fallback.used', tool: 'ctx_get_file' }),
      ].join('\n') + '\n',
      'utf-8',
    );

    const events = readEvents({
      since: new Date('2026-05-18T00:00:00Z'),
      until: new Date('2026-05-18T23:59:59Z'),
    });

    // Pre-fix: all 3 events would pass (NaN < x && NaN > x are both
    // false, so the malformed events slip through and contaminate
    // budget-stats aggregations). Post-fix: only the well-formed
    // event survives.
    expect(events).toHaveLength(1);
    expect(events[0].tool).toBe('ctx_get_file');
    expect(events[0].ts).toBe('2026-05-18T12:00:00.000Z');
  });
});
