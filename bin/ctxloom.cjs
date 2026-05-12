#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

/**
 * ctxloom — CJS bootstrap that bumps the file-descriptor soft limit
 * before loading the ESM entry point.
 *
 * Why this exists
 * ───────────────
 * Node.js does not expose `setrlimit(2)` natively, so we cannot raise
 * RLIMIT_NOFILE from inside the JS runtime. macOS's launchctl default
 * is `maxfiles = 256` (soft) / `unlimited` (hard), and every child
 * process spawned by Claude.app / VS Code inherits that 256 soft cap.
 *
 * During a long-lived MCP session the cap is exhausted within ~20 tool
 * calls — LanceDB keeps SSTable file handles open across queries, the
 * ONNX runtime holds the model.onnx mmap, tree-sitter holds each WASM
 * grammar, and the ~80 source files indexed at boot each leave a
 * residual handle. The result is an EMFILE cascade that breaks every
 * subsequent tool, including plain `fs.readFile`.
 *
 * Strategy
 * ────────
 * Re-exec ourselves through `/bin/sh -c "ulimit -n 65536; exec node …"`,
 * gated by an env var to prevent an exec loop. On the second pass the
 * raised limit is in place and we dynamic-import the real ESM entry.
 *
 * Windows is unaffected (the FD limit is much higher there, and `sh`
 * is unavailable), so we skip the bump and load directly.
 *
 * Safe to call when the limit is already higher than our target — the
 * second `ulimit` invocation is a no-op when the value is already at
 * or above 65536.
 */

const path = require('node:path');

const FD_LIMIT_TARGET = 65536;
const SENTINEL_ENV = 'CTXLOOM_FD_BUMPED';
const ENTRY = path.join(__dirname, '..', 'dist', 'index.js');

function shellQuote(arg) {
  // POSIX-safe single-quote escape: a' becomes 'a'\'''.
  return `'${String(arg).replace(/'/g, "'\\''")}'`;
}

function shouldBump() {
  if (process.env[SENTINEL_ENV] === '1') return false;
  if (process.platform === 'win32') return false;
  // Allow opt-out for unusual environments (e.g. setuid wrappers, CI
  // runners that already manage rlimit themselves).
  if (process.env['CTXLOOM_SKIP_FD_BUMP'] === '1') return false;
  return true;
}

if (shouldBump()) {
  const { spawnSync } = require('node:child_process');
  const quotedExec = shellQuote(process.execPath);
  // process.argv[0] is the node path; argv[1] is THIS script; argv[2…] are
  // the user's args. We want to re-exec node against the same script with
  // the same user args, so we keep argv[1…] intact.
  const quotedArgs = process.argv.slice(1).map(shellQuote).join(' ');
  const cmd =
    `ulimit -n ${FD_LIMIT_TARGET} 2>/dev/null; ` +
    `${SENTINEL_ENV}=1 exec ${quotedExec} ${quotedArgs}`;
  const result = spawnSync('/bin/sh', ['-c', cmd], { stdio: 'inherit' });
  // spawnSync sets `status` on normal exit and `signal` on signal exit.
  if (result.signal) {
    process.kill(process.pid, result.signal);
    // Fallback in case the signal is non-terminating in this context.
    process.exit(1);
  }
  process.exit(result.status == null ? 1 : result.status);
}

// On the second pass (or on Windows) load the real ESM entry.
import(ENTRY).catch((err) => {
  // Surface errors clearly — without this the user sees an unhandled
  // promise rejection with no stack trace pointing back to the wrapper.
  process.stderr.write(
    `ctxloom: failed to load entry ${ENTRY}\n${err && err.stack ? err.stack : err}\n`,
  );
  process.exit(1);
});
