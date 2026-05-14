#!/usr/bin/env node
/**
 * Purge stale build artifacts from src/.
 *
 * src/ is TypeScript-only — every `.js`, `.d.ts`, `.js.map`, or `.d.ts.map`
 * sitting next to a `.ts` source is a leftover from a long-ago `tsc`-output
 * build (pre-monorepo layout). They're gitignored so CI never sees them, but
 * locally they confuse vitest:
 *
 *   `await import('../src/foo/Bar.js')` matches the stale `.js` literally
 *   instead of resolving to `Bar.ts`, then chases a broken re-export and
 *   tests fail with "Cannot find module …".
 *
 * Wired into `prebuild` and `pretest` so the next person who clones (or
 * pulls after a refactor) can't get bitten the same way. No-op if nothing
 * stale is present.
 *
 * Cross-platform: pure Node, no `find`. Skips dotfiles (.git etc.) and
 * leaves anything outside src/ alone.
 */
import { readdirSync, statSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STALE_SUFFIXES = [".js", ".js.map", ".d.ts", ".d.ts.map"];

// Files that legitimately live as .js inside otherwise-TypeScript trees
// (Tailwind/PostCSS configs, etc.). Don't sweep these — they're build
// inputs, not stale artifacts.
const ALLOWLIST = new Set([
  "tailwind.config.js",
  "postcss.config.js",
  "vite.config.js",
  "vitest.config.js",
]);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Every directory in the monorepo that should be TypeScript-only.
// Root, plus each workspace package's src/. Without this, stale
// .js files in packages/core/src/ get picked up by tsup-bundling
// consumers (apps/pr-bot, etc.) — they shadow the .ts source and
// resolve to pre-refactor module shapes.
function collectSrcDirs() {
  const dirs = [];
  const candidates = [
    path.join(repoRoot, "src"),
  ];

  // Walk packages/* and apps/* looking for src/ subdirs.
  for (const groupDir of ["packages", "apps"]) {
    const groupPath = path.join(repoRoot, groupDir);
    if (!existsSync(groupPath)) continue;
    for (const entry of readdirSync(groupPath)) {
      if (entry.startsWith(".")) continue;
      candidates.push(path.join(groupPath, entry, "src"));
      // apps/dashboard ships TypeScript in server/ and client/ rather
      // than src/, so include those too.
      candidates.push(path.join(groupPath, entry, "server"));
      candidates.push(path.join(groupPath, entry, "client"));
    }
  }

  for (const dir of candidates) {
    if (existsSync(dir)) dirs.push(dir);
  }
  return dirs;
}

let removed = 0;

function isStale(filename) {
  if (ALLOWLIST.has(filename)) return false;
  return STALE_SUFFIXES.some((suf) => filename.endsWith(suf));
}

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // src/ may not exist in some checkouts; skip silently
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full);
    } else if (st.isFile() && isStale(entry)) {
      rmSync(full, { force: true });
      removed++;
    }
  }
}

for (const dir of collectSrcDirs()) {
  walk(dir);
}

if (removed > 0) {
  console.log(`[clean-stale-src] removed ${removed} stale build artifact(s)`);
}
