#!/usr/bin/env node
/**
 * Publish smoke-test guard.
 *
 * Catches release-time bugs that nothing else does:
 *   1. Workspace-deps trap (the v1.0.8 disaster) — npm-install fails for
 *      consumers because dependencies references a private workspace
 *      package that doesn't exist on the registry.
 *   2. Missing files in the published tarball (the dashboard-not-shipped
 *      bug from v1.0.5/.6) — `package.json#files` whitelist incomplete.
 *   3. Build artefacts wired to wrong paths (v1.0.6 dashboard path
 *      mismatch) — fails when the published bin tries to load them.
 *
 * What it does:
 *   - `npm pack` produces a tarball as if for publish (no actual upload)
 *   - extracts into a fresh tmp dir
 *   - runs `npm install` against ONLY the npm registry (no workspaces)
 *   - sanity-runs the bin: `ctxloom --help` should exit 0
 *
 * Failures here PREVENT publish — wired into prepublishOnly so a broken
 * release tarball never reaches npmjs.
 *
 * Skipped when SKIP_PUBLISH_SMOKE=1 is set (e.g. CI re-runs after a
 * confirmed-good earlier pack, or local emergency overrides).
 */
import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

if (process.env.SKIP_PUBLISH_SMOKE === "1") {
  console.log("[publish-smoke] skipped (SKIP_PUBLISH_SMOKE=1)");
  process.exit(0);
}

const log = (msg) => console.log(`[publish-smoke] ${msg}`);
const fail = (msg) => {
  console.error(`[publish-smoke] ✗ ${msg}`);
  process.exit(1);
};

// ── 1. Validate package.json doesn't reference workspace-internal packages
//      in a way that survives publish (the v1.0.8 trap).
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const banned = [];
for (const [name] of Object.entries(pkg.dependencies ?? {})) {
  if (name.startsWith("@ctxloom/")) {
    banned.push(`dependencies['${name}']`);
  }
}
for (const [name] of Object.entries(pkg.peerDependencies ?? {})) {
  if (name.startsWith("@ctxloom/")) {
    banned.push(`peerDependencies['${name}']`);
  }
}
if (banned.length) {
  fail(
    `package.json references private @ctxloom/* packages in runtime deps:\n  ${banned.join("\n  ")}\n` +
      `These get published as-is; consumers' npm install will 404. Move to devDependencies (tsup bundles them).`,
  );
}
log("package.json runtime deps clean (no @ctxloom/* leakage)");

// ── 2. Pack the package (same tarball as `npm publish` would upload).
log("packing tarball…");
const packOutput = execFileSync("npm", ["pack", "--json"], {
  cwd: repoRoot,
  encoding: "utf8",
});
const packed = JSON.parse(packOutput);
const tarballName = packed[0].filename;
const tarballPath = path.resolve(repoRoot, tarballName);
log(`packed: ${tarballName} (${(packed[0].size / 1024).toFixed(1)} KB)`);

// ── 3. Extract + install into a clean tmp dir, isolated from the workspace.
const tmpDir = mkdtempSync(path.join(tmpdir(), "ctxloom-publish-smoke-"));
try {
  log(`fresh-install in ${tmpDir}`);
  // Need a minimal package.json so npm install resolves the tarball.
  spawnSync("npm", ["init", "-y"], { cwd: tmpDir, stdio: "ignore" });
  // Install from the local tarball — this is what consumers do via
  // `npm install -g ctxloom-pro` after publish, just hitting our local
  // file instead of the registry.
  const install = spawnSync(
    "npm",
    [
      "install",
      tarballPath,
      "--no-fund",
      "--no-audit",
      "--ignore-scripts", // skip postinstall — don't run our own setup wizard
    ],
    { cwd: tmpDir, encoding: "utf8" },
  );
  if (install.status !== 0) {
    fail(
      `npm install from tarball failed:\n${install.stdout}\n${install.stderr}`,
    );
  }

  // ── 4. Verify the bin lands at the expected path + can launch.
  const binPath = path.join(tmpDir, "node_modules", ".bin", "ctxloom");
  if (!existsSync(binPath)) {
    fail(`bin not present at node_modules/.bin/ctxloom`);
  }
  log(`bin installed at ${binPath}`);

  // Run --help with a 10s timeout. Should exit 0 with non-empty stdout.
  const help = spawnSync("node", [binPath, "--help"], {
    cwd: tmpDir,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (help.status !== 0) {
    fail(
      `\`ctxloom --help\` exited ${help.status}\nstdout:\n${help.stdout}\nstderr:\n${help.stderr}`,
    );
  }
  if (!help.stdout.includes("ctxloom")) {
    fail(`\`ctxloom --help\` ran but output didn't include 'ctxloom':\n${help.stdout}`);
  }
  log("`ctxloom --help` ran cleanly");

  // ── 5. Verify the dashboard server entry is shipped + importable.
  const dashEntry = path.join(
    tmpDir,
    "node_modules/ctxloom-pro/apps/dashboard/dist/server/index.js",
  );
  if (!existsSync(dashEntry)) {
    fail(`dashboard server entry missing from tarball: ${dashEntry}`);
  }
  log("dashboard server entry present");

  // ── 6. Actually boot the dashboard and curl /. The previous existence
  //      check missed the v1.0.13 path-to-regexp / express-5 wildcard
  //      crash and the v1.0.10–.12 dist/dist/ ENOENT — both surfaced
  //      only at runtime. This step exercises the real consumer path:
  //      tarball install → resolved transitive deps (express 5 via
  //      @modelcontextprotocol/sdk) → SPA fallback route.
  await dashboardServesIndex(tmpDir, dashEntry);
  log("dashboard boots and serves index.html (200 OK)");

  // ── 7. Verify telemetry keys are baked into the bundle. We discovered
  //      after v1.0.23 shipped that 23 consecutive releases had empty
  //      __TELEMETRY_POSTHOG_KEY__ and __TELEMETRY_SENTRY_DSN__ inlined
  //      because the env vars weren't set when `npm publish` ran. The
  //      bundle compiled to:
  //          POSTHOG_KEY = process.env["POSTHOG_API_KEY"] ?? (true ? "" : "")
  //      and the early-return guard in telemetry.ts dropped every event.
  //      Result: PostHog dashboard was blank for the entire launch period.
  //      This guard scans the installed bundle for the empty-fallback
  //      pattern and fails publish if telemetry would silently no-op.
  //
  //      Escape hatch: CTXLOOM_ALLOW_NO_TELEMETRY=1 for intentional
  //      no-telemetry builds (forks, sandboxed dev rebuilds).
  verifyTelemetryBaked(path.join(tmpDir, "node_modules/ctxloom-pro/dist"));
  log("telemetry keys verified in bundle");
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
  // Always clean up the tarball — it sits at the repo root after npm pack.
  try {
    rmSync(tarballPath, { force: true });
  } catch {
    /* ignore */
  }
}

log("✓ publish smoke-test passed");

/**
 * Scan the installed bundle for the telemetry-key assignments and fail
 * if either is the empty-fallback that tsup compiles when the build-time
 * env vars (CTXLOOM_BUILD_POSTHOG_KEY / CTXLOOM_BUILD_SENTRY_DSN) are
 * unset.
 *
 * tsup's `define` substitutes __TELEMETRY_POSTHOG_KEY__ at build time.
 * When the env var is set to "phc_real_key", the bundle reads:
 *     POSTHOG_KEY = process.env["POSTHOG_API_KEY"] ?? "phc_real_key"
 * When unset, it reads:
 *     POSTHOG_KEY = process.env["POSTHOG_API_KEY"] ?? (true ? "" : "")
 * The guard in telemetry.ts (`if (!POSTHOG_KEY) return`) then short-
 * circuits every event. This check catches the latter shape.
 */
function verifyTelemetryBaked(distDir) {
  if (process.env.CTXLOOM_ALLOW_NO_TELEMETRY === "1") {
    log("telemetry check skipped (CTXLOOM_ALLOW_NO_TELEMETRY=1)");
    return;
  }
  if (!existsSync(distDir)) {
    fail(`expected dist dir at ${distDir}`);
  }
  const candidates = readdirSync(distDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(distDir, f));

  let foundPosthog = false;
  let foundSentry = false;
  let posthogEmpty = false;
  let sentryEmpty = false;

  for (const filePath of candidates) {
    const content = readFileSync(filePath, "utf8");
    // tsup's `define` substitution preserves the source's typeof guard, so
    // the compiled shape is one of:
    //   POSTHOG_KEY = process.env[...] ?? "phc_..."             (minified)
    //   POSTHOG_KEY = process.env[...] ?? (true ? "phc_..." : "") (default)
    //   POSTHOG_KEY = process.env[...] ?? (true ? "" : "")       (empty fallback)
    // The reliable test is whether any `phc_<id>` literal appears in the
    // expression, not the exact ?? structure.
    const posthogMatch = content.match(/POSTHOG_KEY\s*=\s*([^;\n]{1,300})/);
    if (posthogMatch) {
      foundPosthog = true;
      const expr = posthogMatch[1];
      const hasRealKey = /"phc_[a-zA-Z0-9_]{16,}"/.test(expr);
      if (!hasRealKey) posthogEmpty = true;
    }
    const sentryMatch = content.match(/SENTRY_DSN\s*=\s*([^;\n]{1,300})/);
    if (sentryMatch) {
      foundSentry = true;
      const expr = sentryMatch[1];
      // Sentry DSN format: https://<key>@<host>/<projectId>
      const hasRealDsn = /"https:\/\/[^"@\s]+@[^"\s]+"/.test(expr);
      if (!hasRealDsn) sentryEmpty = true;
    }
  }

  const issues = [];
  if (!foundPosthog) issues.push("POSTHOG_KEY assignment not found in bundle (telemetry.ts may have been refactored)");
  if (posthogEmpty) issues.push("POSTHOG_KEY is the empty fallback — set CTXLOOM_BUILD_POSTHOG_KEY before npm publish");
  if (!foundSentry) issues.push("SENTRY_DSN assignment not found in bundle");
  if (sentryEmpty) issues.push("SENTRY_DSN is the empty fallback — set CTXLOOM_BUILD_SENTRY_DSN before npm publish");

  if (issues.length) {
    fail(
      `telemetry-keys check failed:\n  ${issues.join("\n  ")}\n\n` +
        `If this is an intentional no-telemetry build (fork, sandbox), re-run with CTXLOOM_ALLOW_NO_TELEMETRY=1.`,
    );
  }
}

/**
 * Boot the dashboard against the freshly installed tarball, hit / and
 * verify a 200 OK with non-empty HTML. Fails the smoke-test on any
 * crash (path-to-regexp errors, ENOENT on index.html, port collisions).
 *
 * Picks a random high port to avoid clashing with anything the user has
 * running locally or in CI. Times out at 10s — the dashboard usually
 * boots in <2s.
 */
async function dashboardServesIndex(tmpDirArg, dashEntryArg) {
  const port = 30000 + Math.floor(Math.random() * 30000);
  log(`booting dashboard on :${port}…`);
  // macOS routes /var/folders/... through /private/var/folders/... — argv[1]
  // and import.meta.url disagree about which one to use, defeating the
  // server's `process.argv[1] === fileURLToPath(import.meta.url)` guard.
  // Pass the realpath-resolved path so both sides agree and startDashboard
  // actually runs.
  const realDashEntry = realpathSync(dashEntryArg);
  const realTmpDir = realpathSync(tmpDirArg);
  const child = spawn("node", [realDashEntry], {
    cwd: realTmpDir,
    env: { ...process.env, CTXLOOM_ROOT: realTmpDir, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrChunks = [];
  const stdoutChunks = [];
  child.stderr.on("data", (c) => stderrChunks.push(c));
  child.stdout.on("data", (c) => stdoutChunks.push(c));
  let exited = false;
  let exitCode = null;
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  // Poll up to 10s for /. Crash-out early if the child died.
  const deadline = Date.now() + 10_000;
  let lastErr = "";
  while (Date.now() < deadline) {
    if (exited) {
      child.kill("SIGKILL");
      fail(
        `dashboard exited with code ${exitCode} before serving /\nstdout:\n${Buffer.concat(stdoutChunks).toString()}\nstderr:\n${Buffer.concat(stderrChunks).toString()}`,
      );
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      const body = await res.text();
      child.kill("SIGTERM");
      // Drain any remaining IO so the process actually exits.
      await delay(100);
      if (!child.killed) child.kill("SIGKILL");
      if (res.status !== 200) {
        fail(`dashboard returned ${res.status} for / (expected 200)\nbody:\n${body.slice(0, 500)}`);
      }
      if (!body.includes("<!doctype html") && !body.includes("<!DOCTYPE html")) {
        fail(`dashboard returned 200 but body wasn't HTML:\n${body.slice(0, 500)}`);
      }
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await delay(250);
    }
  }
  child.kill("SIGKILL");
  fail(
    `dashboard did not serve / within 10s (last fetch error: ${lastErr})\nstderr:\n${Buffer.concat(stderrChunks).toString()}`,
  );
}
