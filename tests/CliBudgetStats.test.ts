/**
 * Integration tests for the `ctxloom budget-stats` CLI command.
 *
 * Closes TEST-135-3 from PR #135's dogfood. The 32 unit tests in
 * tests/BudgetEventCollector.test.ts + tests/BudgetStats.test.ts
 * cover the inner pieces (readEvents, summarize, renderSummary);
 * this file covers the CLI wiring — flag parsing, validation,
 * filter threading, and end-to-end output rendering.
 *
 * Approach: spawn `tsx src/index.ts budget-stats <args>` against a
 * temp CTXLOOM_TELEMETRY_DIR per test. Using tsx (rather than the
 * built bin/ctxloom.cjs wrapper) lets these tests run in `npm test`
 * without a pre-build step. CI's "Build + test" job exercises the
 * built bin separately.
 *
 * Each test seeds the temp telemetry dir with deterministic JSONL
 * events, runs the CLI, and asserts on stdout + exit code.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI_ENTRY = resolve(__dirname, '..', 'src', 'index.ts');

/**
 * Spawn the CLI synchronously with a temp telemetry dir. Returns
 * stdout, stderr, and exit code so each test can assert on whatever
 * surface matters. Uses `npx tsx` so no build is required.
 *
 * `budget-stats` is in LICENSE_GATE_BYPASS_COMMANDS (it's a local
 * read-only command — no MCP, no API, no graph build), so these
 * tests don't need a valid license. CTXLOOM_LICENSE_KEY is
 * explicitly UNSET so a developer's real key doesn't accidentally
 * affect test behavior.
 */
function runCli(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  // Clone the parent env minus any license/telemetry vars that could
  // skew the test. CTXLOOM_TELEMETRY_DIR comes in via `env` per test.
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'CTXLOOM_LICENSE_KEY' || k.startsWith('CTXLOOM_TELEMETRY_')) continue;
    baseEnv[k] = v;
  }
  const result = spawnSync('npx', ['tsx', CLI_ENTRY, ...args], {
    env: {
      ...baseEnv,
      // Force CLI log mode (the auto-detect uses process.argv length
      // and gets confused under spawn — explicit override is cleaner).
      CTXLOOM_LOG_MODE: 'cli',
      ...env,
    },
    encoding: 'utf-8',
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  };
}

function seedTelemetry(dir: string, events: Array<Record<string, unknown>>): void {
  // Write all events into today's UTC file so the default 14-day
  // window picks them up. Tests that need older events override the
  // filename explicitly.
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  const d = String(today.getUTCDate()).padStart(2, '0');
  const file = join(dir, `budget-events-${y}-${m}-${d}.jsonl`);
  const lines = events.map((e) => JSON.stringify({ ts: today.toISOString(), ...e })).join('\n') + '\n';
  writeFileSync(file, lines, 'utf-8');
}

describe('ctxloom budget-stats CLI', () => {
  let telemetryDir: string;

  beforeEach(() => {
    telemetryDir = mkdtempSync(join(tmpdir(), 'ctxloom-cli-stats-test-'));
  });

  afterEach(() => {
    rmSync(telemetryDir, { recursive: true, force: true });
  });

  // ── empty telemetry → "No events in window" success ─────────────

  it('exits 0 and prints the no-events diagnostic when telemetry dir is empty', () => {
    const r = runCli(['budget-stats'], { CTXLOOM_TELEMETRY_DIR: telemetryDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No events in window');
    expect(r.stdout).toContain('CTXLOOM_TELEMETRY_LEVEL');
  });

  // ── default window: 14 days when --window is omitted ────────────

  it('defaults to a 14-day window when --window is not passed', () => {
    seedTelemetry(telemetryDir, [
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 9000 },
    ]);
    const r = runCli(['budget-stats'], { CTXLOOM_TELEMETRY_DIR: telemetryDir });
    expect(r.status).toBe(0);
    // The header line includes both window-bound dates; pin that two
    // ISO-style dates appear and are exactly 14 days apart.
    const dateMatches = r.stdout.match(/(\d{4}-\d{2}-\d{2})/g);
    expect(dateMatches).not.toBeNull();
    expect(dateMatches!.length).toBeGreaterThanOrEqual(2);
    const [start, end] = [new Date(dateMatches![0]), new Date(dateMatches![1])];
    const spanDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    expect(spanDays).toBe(14);
  });

  // ── --window=Nd parses correctly ────────────────────────────────

  it('--window=7d narrows the window to 7 days', () => {
    seedTelemetry(telemetryDir, [
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 9000 },
    ]);
    const r = runCli(['budget-stats', '--window=7d'], { CTXLOOM_TELEMETRY_DIR: telemetryDir });
    expect(r.status).toBe(0);
    const dateMatches = r.stdout.match(/(\d{4}-\d{2}-\d{2})/g)!;
    const [start, end] = [new Date(dateMatches[0]), new Date(dateMatches[1])];
    const spanDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    expect(spanDays).toBe(7);
  });

  // ── --window validation: bad values exit 1 ──────────────────────

  it.each([
    'foo',     // non-numeric
    '0d',      // zero
    '-3d',     // negative (parseInt yields NaN-like flow)
    'abc14d',  // garbage
  ])('--window=%s exits with code 1 and a clear stderr error', (badWindow) => {
    const r = runCli(['budget-stats', `--window=${badWindow}`], { CTXLOOM_TELEMETRY_DIR: telemetryDir });
    expect(r.status).toBe(1);
    expect(r.stderr.toLowerCase()).toMatch(/invalid.*--window/);
  });

  // ── --tool filter threads through to readEvents ─────────────────

  it('--tool=ctx_search filters out events for other tools', () => {
    seedTelemetry(telemetryDir, [
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 9000 },
      { event: 'mcp.budget.exceeded', tool: 'ctx_search', original_tokens: 5000 },
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_definition', original_tokens: 3000 },
    ]);
    const r = runCli(['budget-stats', '--tool=ctx_search'], { CTXLOOM_TELEMETRY_DIR: telemetryDir });
    expect(r.status).toBe(0);
    // Distribution table should contain ctx_search but NOT the others.
    expect(r.stdout).toContain('ctx_search');
    expect(r.stdout).not.toContain('ctx_get_file');
    expect(r.stdout).not.toContain('ctx_get_definition');
  });

  // ── populated output renders both tables ────────────────────────

  it('renders both fallback + distribution tables when events are present', () => {
    seedTelemetry(telemetryDir, [
      { event: 'mcp.budget.exceeded', tool: 'ctx_get_file', original_tokens: 9000 },
      { event: 'mcp.fallback.used', tool: 'ctx_get_file', fallback_reason: 'budget_exceeded', mode: 'skeleton' },
    ]);
    const r = runCli(['budget-stats'], { CTXLOOM_TELEMETRY_DIR: telemetryDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Fallback distribution per tool');
    expect(r.stdout).toContain('Original-token distribution per tool');
    expect(r.stdout).toContain('ctx_get_file');
    // Footer that names p75 as the tuning input (the load-bearing
    // narrative for the downstream per-tool tuning follow-up).
    expect(r.stdout).toMatch(/p75.*column is the input.*tuning/i);
  });

  // ── dynamic-import path resolves (the path the test specialist
  // ── called out specifically — a tsc output-dir reshuffle would
  // ── silently break this otherwise) ──────────────────────────────

  it('successfully dynamic-imports eventCollector + budgetStats from the case block', () => {
    // If the dynamic import path in src/index.ts:746-747 fails to
    // resolve, the spawn returns a non-zero exit with the resolver
    // error in stderr. A successful exit-0 here is sufficient
    // evidence that BOTH lazy imports loaded cleanly.
    const r = runCli(['budget-stats'], { CTXLOOM_TELEMETRY_DIR: telemetryDir });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('Cannot find module');
    expect(r.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
  });
});
