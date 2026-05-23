/**
 * CLI tests for the v1.7.3 fixes to the catastrophic `ctxloom update`
 * bug. Real-world repro: a 63-file Python project (EasyMoney) had its
 * `.ctxloom/vectors.lancedb` directory bloated to 56,710 transaction
 * files because the `ctxloom init` PostToolUse hook fired `ctxloom
 * update --incremental --quiet` on every Write|Edit, no `update`
 * subcommand existed, the CLI silently fell through to `default:`
 * which started a *new* MCP server, and every PostToolUse fire
 * spawned an orphan server that held FDs and re-upserted files.
 *
 * These tests pin two behaviors that close the door:
 *
 *   1. `ctxloom update` is now a real (no-op) subcommand that exits 0
 *      and DOES NOT start an MCP server. Tested with --incremental,
 *      --quiet, both, and bare invocation.
 *
 *   2. Unknown commands exit 1 with a clear error — they no longer
 *      fall through to MCP-server mode. This is the structural fix
 *      that prevents this exact bug class from happening again with
 *      some future hypothetical typo.
 *
 * Strategy mirrors tests/CliBudgetStats.test.ts: spawn `tsx
 * src/index.ts <args>` synchronously, assert on exit code + output.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI_ENTRY = resolve(__dirname, '..', 'src', 'index.ts');

/**
 * Spawn the CLI synchronously with a tight timeout. If the bug ever
 * regresses (unknown command falls through to MCP server mode), the
 * server starts on stdio and never exits — the timeout catches it
 * deterministically rather than hanging the test suite.
 *
 * Excludes CTXLOOM_LICENSE_KEY so a developer's real key doesn't
 * affect behavior; `update` is in the license-gate bypass list (it's
 * a no-op, no graph touched).
 */
function runCli(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null; signal: NodeJS.Signals | null } {
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'CTXLOOM_LICENSE_KEY') continue;
    baseEnv[k] = v;
  }
  const result = spawnSync('npx', ['tsx', CLI_ENTRY, ...args], {
    env: {
      ...baseEnv,
      CTXLOOM_LOG_MODE: 'cli',
      ...env,
    },
    encoding: 'utf-8',
    timeout: 8_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    signal: result.signal,
  };
}

describe('ctxloom update CLI', () => {
  it('exits 0 with --incremental --quiet (the hook-installed form)', () => {
    const r = runCli(['update', '--incremental', '--quiet']);
    expect(r.status).toBe(0);
    expect(r.signal).toBeNull();
    // Quiet means quiet — no stdout banner.
    expect(r.stdout.trim()).toBe('');
  });

  it('exits 0 with --incremental and prints a no-op banner when not quiet', () => {
    const r = runCli(['update', '--incremental']);
    expect(r.status).toBe(0);
    expect(r.signal).toBeNull();
    expect(r.stdout).toMatch(/no-op|FileWatcher/i);
  });

  it('exits 0 with bare `update` (no flags)', () => {
    const r = runCli(['update']);
    expect(r.status).toBe(0);
    expect(r.signal).toBeNull();
  });

  it('returns promptly — never falls through to MCP server mode', () => {
    // The pre-v1.7.3 bug: `update` was unknown → default case in
    // src/index.ts ran startServer() → process lived forever on
    // stdio. The runCli timeout (8s) would fire and result.signal
    // would be 'SIGTERM'. This test pins the structural fix.
    const r = runCli(['update', '--incremental', '--quiet']);
    expect(r.signal).toBeNull();
    expect(r.status).toBe(0);
  });
});

describe('ctxloom unknown-command rejection', () => {
  it('exits 1 with a clear error on an unrecognized subcommand', () => {
    const r = runCli(['definitely-not-a-real-command']);
    expect(r.status).toBe(1);
    expect(r.signal).toBeNull();
    expect(r.stderr).toMatch(/[Uu]nknown command/);
    expect(r.stderr).toMatch(/definitely-not-a-real-command/);
    // Should point users at help + at the correct way to start the MCP
    // server, since the previous behavior conflated unknown commands
    // with MCP-server mode.
    expect(r.stderr).toMatch(/--help/);
  });

  it('never starts the MCP server on an unknown command', () => {
    // Same shape as the deterministic-exit test for `update` — if the
    // regression returns, this test times out with SIGTERM instead of
    // exit code 1.
    const r = runCli(['totally-bogus-subcommand']);
    expect(r.signal).toBeNull();
    expect(r.status).toBe(1);
  });
});
