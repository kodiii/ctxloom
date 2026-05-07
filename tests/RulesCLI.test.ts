import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexTs = path.join(repoRoot, 'src', 'index.ts');
const fixturesDir = path.join(repoRoot, 'test', 'fixtures', 'rules');

// CTXLOOM_LICENSE_BYPASS env var was removed (security audit M-1).
// Write a real license file into a tmp HOME so the gate passes through
// the normal isActive() fast path, exercising the same code real users hit.
const tmpHome = path.join(tmpdir(), `ctxloom-rulescli-${process.pid}-${Date.now()}`);

beforeAll(() => {
  mkdirSync(path.join(tmpHome, '.ctxloom'), { recursive: true });
  const license = {
    schemaVersion: 1,
    key: 'ctxl_pro_test_fixture',
    tier: 'pro',
    status: 'active',
    fingerprint: 'sha256:' + 'a'.repeat(64),
    seats: 1,
    issuedAt: new Date(Date.now() - 86_400_000).toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    lastValidatedAt: new Date().toISOString(),
    licenseId: 'lk_test',
    instanceId: 'act_test',
  };
  writeFileSync(
    path.join(tmpHome, '.ctxloom', 'license.json'),
    JSON.stringify(license, null, 2),
  );
});

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

async function runCheck(
  fixture: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execAsync(
      'node',
      ['--import', 'tsx/esm', indexTs, 'rules', 'check', ...args],
      {
        cwd: path.join(fixturesDir, fixture),
        env: { ...process.env, FORCE_COLOR: '0', HOME: tmpHome },
      },
    );
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
  }
}

describe('ctxloom rules check — CLI integration', () => {
  it('exits 0 with 0 violations on a clean repo', async () => {
    const { exitCode, stdout } = await runCheck('clean-repo');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('0 violations');
  }, 30_000);

  it('exits 1 with violations on a violating repo', async () => {
    const { exitCode, stdout } = await runCheck('violating-repo');
    expect(exitCode).toBe(1);
    expect(stdout).toContain('[ERROR]');
    expect(stdout).toContain('domain must not import infra');
  }, 30_000);

  it('exits 0 and emits hint to stderr when no config file exists', async () => {
    const { exitCode, stdout, stderr } = await runCheck('no-config');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
    expect(stderr).toContain('.ctxloom/rules.yml');
  }, 30_000);

  it('exits 2 on malformed YAML config', async () => {
    const { exitCode, stderr } = await runCheck('bad-config');
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Config error');
  }, 30_000);

  it('emits valid JSON to stdout with --json flag, violations not mixed into stderr', async () => {
    const { exitCode, stdout, stderr } = await runCheck('violating-repo', ['--json']);
    expect(exitCode).toBe(1);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.violations.length).toBeGreaterThan(0);
    // Progress lines (graph build) go to stderr — violations must not appear there
    expect(stderr).not.toContain('[ERROR]');
  }, 30_000);

  it('--json emits full violation list regardless of count', async () => {
    const { stdout } = await runCheck('violating-repo', ['--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.violations).toHaveLength(2);
  }, 30_000);
});
