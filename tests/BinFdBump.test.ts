/**
 * Tests for bin/ctxloom.cjs — the FD-limit bootstrap.
 *
 * Verifies that:
 *   1. The wrapper re-execs through `/bin/sh` and raises RLIMIT_NOFILE
 *      to at least the target (65536) before loading the ESM entry.
 *   2. The sentinel env var (`CTXLOOM_FD_BUMPED=1`) makes the wrapper
 *      skip the bump and load the entry directly — preventing exec loops.
 *   3. `CTXLOOM_SKIP_FD_BUMP=1` is honored as an opt-out for environments
 *      that manage rlimit externally (CI, setuid wrappers).
 *   4. Argv with spaces and quotes survives the sh-quote round-trip.
 *
 * The wrapper dynamic-imports `dist/index.js`, which we don't have in a
 * clean test environment — so instead of running the real bin, the tests
 * point the wrapper at a tiny stub by overriding the `ENTRY` symbol via
 * a shim file. Since the wrapper computes ENTRY from `__dirname`, the
 * shim approach uses `node -e` to inline-eval the wrapper with a patched
 * ENTRY.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const WRAPPER = path.join(REPO_ROOT, 'bin', 'ctxloom.cjs');

function makeProbeEntry(tmpDir: string): string {
  // ESM stub that prints ulimit + sentinel as a JSON line for parsing.
  const stubPath = path.join(tmpDir, 'probe-entry.mjs');
  fs.writeFileSync(
    stubPath,
    `import { execSync } from 'node:child_process';
const limit = execSync('ulimit -n', { shell: '/bin/sh' }).toString().trim();
process.stdout.write(JSON.stringify({
  limit: Number(limit),
  // Treat empty-string env vars as "unset" — node-spawn passes through
  // empty strings rather than omitting the variable, and the probe needs
  // to distinguish "wrapper set sentinel=1" from "caller passed nothing".
  sentinel: process.env.CTXLOOM_FD_BUMPED || null,
  argv: process.argv.slice(2),
}) + '\\n');
`,
  );
  return stubPath;
}

function makePatchedWrapper(tmpDir: string, entry: string): string {
  // Copy the wrapper, redirect ENTRY to the probe stub. We do this by
  // string-replacing the path.join that computes ENTRY, since the wrapper
  // is otherwise a pure module-level script.
  const src = fs.readFileSync(WRAPPER, 'utf-8');
  const patched = src.replace(
    /const ENTRY = .+;$/m,
    `const ENTRY = ${JSON.stringify(entry)};`,
  );
  const outPath = path.join(tmpDir, 'ctxloom.cjs');
  fs.writeFileSync(outPath, patched, { mode: 0o755 });
  return outPath;
}

describe('bin/ctxloom.cjs FD-limit bootstrap', () => {
  it.skipIf(process.platform === 'win32')(
    'raises RLIMIT_NOFILE to >= 65536 before loading the entry',
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-bin-'));
      try {
        const entry = makeProbeEntry(tmpDir);
        const wrapper = makePatchedWrapper(tmpDir, entry);

        // Lower the SOFT limit before invoking so we can verify the bump
        // took effect. `ulimit -Sn 256` drops soft only — using bare
        // `ulimit -n 256` clamps the hard limit too, which would then
        // prevent raising back to 65536 (the hard limit can never be
        // increased by an unprivileged process).
        //
        // We also drop the sentinel/opt-out env vars by omitting them
        // entirely rather than passing empty strings — Node spawn passes
        // empty strings through verbatim, which is not the same as
        // "unset" in the wrapper's perspective.
        const childEnv: NodeJS.ProcessEnv = { ...process.env };
        delete childEnv.CTXLOOM_FD_BUMPED;
        delete childEnv.CTXLOOM_SKIP_FD_BUMP;
        const result = spawnSync(
          '/bin/sh',
          ['-c', `ulimit -Sn 256 && node "${wrapper}"`],
          { env: childEnv, encoding: 'utf-8' },
        );

        expect(result.status, `stderr: ${result.stderr}`).toBe(0);
        const probe = JSON.parse(result.stdout.trim().split('\n').pop()!);
        expect(probe.limit).toBeGreaterThanOrEqual(65536);
        expect(probe.sentinel).toBe('1');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  it('skips the bump when CTXLOOM_FD_BUMPED=1 is already set (no exec loop)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-bin-'));
    try {
      const entry = makeProbeEntry(tmpDir);
      const wrapper = makePatchedWrapper(tmpDir, entry);

      const result = spawnSync('node', [wrapper], {
        env: { ...process.env, CTXLOOM_FD_BUMPED: '1' },
        encoding: 'utf-8',
      });

      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      const probe = JSON.parse(result.stdout.trim().split('\n').pop()!);
      // Already-set sentinel is preserved verbatim.
      expect(probe.sentinel).toBe('1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('honors CTXLOOM_SKIP_FD_BUMP=1 as an opt-out', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-bin-'));
    try {
      const entry = makeProbeEntry(tmpDir);
      const wrapper = makePatchedWrapper(tmpDir, entry);

      // Sentinel unset, opt-out env set → wrapper must load entry directly
      // without ever calling /bin/sh. Verifiable because we deleted the
      // sentinel entirely from the child env, yet the stub still ran
      // (proving the dynamic-import path was reached).
      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      delete childEnv.CTXLOOM_FD_BUMPED;
      childEnv.CTXLOOM_SKIP_FD_BUMP = '1';
      const result = spawnSync('node', [wrapper], {
        env: childEnv,
        encoding: 'utf-8',
      });

      expect(result.status, `stderr: ${result.stderr}`).toBe(0);
      const probe = JSON.parse(result.stdout.trim().split('\n').pop()!);
      // Opt-out path means the sentinel was never set by the wrapper.
      expect(probe.sentinel).toBe(null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'preserves argv with spaces and single quotes through the sh-quote round-trip',
    () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-bin-'));
      try {
        const entry = makeProbeEntry(tmpDir);
        const wrapper = makePatchedWrapper(tmpDir, entry);

        const tricky = ["plain", "has spaces", "has'single'quote", "has\"dquote"];

        const childEnv: NodeJS.ProcessEnv = { ...process.env };
        delete childEnv.CTXLOOM_FD_BUMPED;
        delete childEnv.CTXLOOM_SKIP_FD_BUMP;
        const result = spawnSync('node', [wrapper, ...tricky], {
          env: childEnv,
          encoding: 'utf-8',
        });

        expect(result.status, `stderr: ${result.stderr}`).toBe(0);
        const probe = JSON.parse(result.stdout.trim().split('\n').pop()!);
        expect(probe.argv).toEqual(tricky);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});
