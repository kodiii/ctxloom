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
