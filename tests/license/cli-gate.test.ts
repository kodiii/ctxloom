/**
 * Integration tests for the license gate wired into src/index.ts.
 * Spawns `tsx src/index.ts` with a tmp HOME directory to test real CLI behavior.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const indexTs = path.join(repoRoot, 'src', 'index.ts');

function tmpHome(): string {
  return mkdtempSync(path.join(tmpdir(), 'ctxloom-gate-test-'));
}

function writeLicense(home: string, overrides: Record<string, unknown> = {}): void {
  const dir = path.join(home, '.ctxloom');
  mkdirSync(dir, { recursive: true });
  const license = {
    schemaVersion: 1,
    key: 'ctxl_pro_abc123',
    tier: 'pro',
    status: 'active',
    fingerprint: 'sha256:' + 'a'.repeat(64),
    seats: 1,
    issuedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
    lastValidatedAt: new Date().toISOString(),
    licenseId: 'lk_abc',
    instanceId: 'act_xyz',
    ...overrides,
  };
  writeFileSync(path.join(dir, 'license.json'), JSON.stringify(license));
}

async function run(
  args: string[],
  env: Record<string, string> = {},
  cwd: string = repoRoot,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execAsync(
      'node',
      ['--import', 'tsx/esm', indexTs, ...args],
      { cwd, env: { ...process.env, HOME: tmpHome(), FORCE_COLOR: '0', ...env }, timeout: 15_000 },
    );
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
  }
}

describe('license gate', () => {
  it('exits 2 for gated command (repos) with no license', async () => {
    const home = tmpHome();
    const { exitCode, stderr } = await run(['repos'], { HOME: home });
    expect(exitCode).toBe(2);
    expect(stderr).toContain('ctxloom trial');
  }, 20_000);

  // CTXLOOM_LICENSE_BYPASS env var was removed in the security backlog
  // sweep — the team's legitimate "use without paying real seats" path
  // is now via the internal Polar product (€0, 5 lifetime activations).
  // Tests below cover the same gate behavior using a real license file
  // written by writeLicense().

  it('exits 0 for gated command with valid cached license', async () => {
    const home = tmpHome();
    writeLicense(home);
    const { exitCode } = await run(['repos'], { HOME: home });
    expect(exitCode).toBe(0);
  }, 20_000);

  it('--help bypasses gate even with no license', async () => {
    const home = tmpHome();
    const { exitCode, stdout } = await run(['--help'], { HOME: home });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('ctxloom');
  }, 20_000);

  it('trial command bypasses gate', async () => {
    const home = tmpHome();
    // trial without --email should print usage (no network call), but must NOT exit 2
    const { exitCode } = await run(['trial', '--email=x@x.com'], {
      HOME: home,
      CTXLOOM_API_BASE: 'http://127.0.0.1:1', // unreachable — will fail gracefully
    });
    // exits non-zero due to network failure, but NOT exit code 2 (gate)
    expect(exitCode).not.toBe(2);
  }, 20_000);

  it('activate command bypasses gate', async () => {
    const home = tmpHome();
    const { exitCode } = await run(['activate', 'ctxl_pro_abc'], {
      HOME: home,
      CTXLOOM_API_BASE: 'http://127.0.0.1:1',
    });
    expect(exitCode).not.toBe(2);
  }, 20_000);

  it('status command bypasses gate', async () => {
    const home = tmpHome();
    const { exitCode, stdout } = await run(['status'], { HOME: home });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('ctxloom trial');
  }, 20_000);
});

describe('ctxloom status', () => {
  it('shows no-license prompt when file is absent', async () => {
    const home = tmpHome();
    const { stdout, exitCode } = await run(['status'], { HOME: home });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('ctxloom trial');
  }, 20_000);

  it('shows license info when file is present', async () => {
    const home = tmpHome();
    writeLicense(home);
    const { stdout, exitCode } = await run(['status'], { HOME: home });
    expect(exitCode).toBe(0);
    // Strip ANSI color codes since tests run in a TTY-aware build.
    // eslint-disable-next-line no-control-regex
    const plain = stdout.replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).toContain('Pro');
    expect(plain).toContain('Active');
    expect(plain).toContain('Expires');
  }, 20_000);
});
