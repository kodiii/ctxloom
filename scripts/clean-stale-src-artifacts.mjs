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
import { readdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STALE_SUFFIXES = [".js", ".js.map", ".d.ts", ".d.ts.map"];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "..", "src");

let removed = 0;

function isStale(filename) {
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

walk(srcDir);

if (removed > 0) {
  console.log(`[clean-stale-src] removed ${removed} stale build artifact(s) from src/`);
}
