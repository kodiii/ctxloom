# Changelog

All notable changes to the **ctxloom VS Code extension** are documented
here. The extension versions independently from the ctxloom CLI
(`ctxloom-pro` on npm); see the [root CHANGELOG](https://github.com/kodiii/ctxloom/blob/main/CHANGELOG.md)
for CLI release notes.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [1.3.3] — 2026-05-15

### Changed

- **Settings panel now surfaces the v1.3 PR-review toggles.** New
  "PR review preview" section between Display and Telemetry exposes
  `previewStatusBar.enabled` and `previewGutter.enabled` as branded
  toggles with a short explanation linking back to the
  `ctxloom: Preview PR review` command. Previously these settings
  were only reachable via Cmd+, → search.

---

## [1.3.2] — 2026-05-15

### Added

- **PR-review gutter decorations** (C3 from the v1.3 feature plan).
  Files in the preview's changed set above-low risk get their changed
  line ranges (from `git diff --unified=0`) tinted in the editor and
  flagged on the overview ruler:
  - 🟠 medium: subtle orange wash
  - 🔴 high: red wash
  - 🚨 critical: deeper red wash
  Low-risk files stay un-decorated so benign PRs don't fill the gutter
  with noise.
- Hover over a decorated line shows: risk band, caller count, hub
  flag, test-coverage status, and the top historical co-change
  siblings (confidence ≥ 50%).
- New setting **`ctxloom.previewGutter.enabled`** (default `true`) —
  setting-gated identically to the status bar so users can turn the
  feature off without uninstalling.
- Reuses the C1 `analyzeWorkingTree()` engine and a new pure helper
  `parseUnifiedDiff()` for hunk extraction. 8 unit tests cover the
  parser (single/multi-line hunks, multiple files, pure deletions,
  renames, paths with spaces and unicode).

### Notes

- Decorations refresh on extension activation, on file save
  (5-second debounce), and on visible-editor change. Stale runs are
  cancelled via a generation counter so the gutter can't get stuck
  on yesterday's analysis.
- Co-exists with the existing churn-based gutter decorations — VS
  Code lets multiple decoration types stack per editor without
  interference.

---

## [1.3.1] — 2026-05-15

### Added

- **PR-review status bar** (C2 from the v1.3 feature plan). New
  status bar item at priority 99 (left of the existing license/per-file
  badge) shows the top-level risk of your current branch versus
  `origin/HEAD` (or the standard fallback chain):
  - 🟢 `ctxloom: low` — no above-low changes
  - 🟠 `ctxloom: medium` — warning-tinted
  - 🔴 `ctxloom: high` — error-tinted
  - 🚨 `ctxloom: critical` — error-tinted
  - `ctxloom: clean` — no files changed
  - `$(question) ctxloom` — no usable base ref (sets a remote-tracking branch)
  Hover for file count + blast radius. Click → opens the full
  `ctxloom: Preview PR review` panel from v1.3.0.
- Refreshes on first activation and on file save (debounced 5 s so a
  format-on-save burst doesn't trigger N graph rebuilds).
- New setting **`ctxloom.previewStatusBar.enabled`** (default `true`).

---

## [1.3.0] — 2026-05-14

### Added

- **`ctxloom: Preview PR review`** — new command palette entry that
  runs the same analysis the ctxloom GitHub Action runs in CI
  (`detectChanges` + `getImpactRadius` from `@ctxloom/core`), but
  against the local working tree vs `origin/HEAD` (or `origin/main`,
  `origin/master`, `main`, `master` — falls through in that order).
  Result is rendered as Markdown in a side-by-side webview panel,
  same shape as the bot's summary comment. Lets you see your risk
  score before opening the PR.
  - Reusable engine in `src/review/analyzeWorkingTree.ts` returns a
    typed `PreviewResult` for future status-bar / decoration
    features to consume.
  - Webview uses VS Code's theme variables so it blends with the
    editor; a Refresh button re-runs after edits without closing
    the panel.
  - When the graph can't be built (fresh checkout, missing
    grammars), falls back to a stub renderer showing the changed
    files with risk based on file count alone.

---

## [1.2.0] — 2026-05-14

### Added

- **Command palette: `ctxloom: Install PR-bot workflow`** — drops
  `.github/workflows/ctxloom-review.yml` into the current workspace
  (shells out to the CLI's `install-pr-bot` command). Requires the
  ctxloom CLI to be installed and on PATH. Shows a VS Code notification
  with the result.
- **README and Settings panel link to [`docs/TELEMETRY.md`](https://github.com/kodiii/ctxloom/blob/main/docs/TELEMETRY.md)** —
  the canonical public reference for what ctxloom collects, what's
  never collected, and how to opt out. The Settings UI's Telemetry
  section now points there explicitly.
- **`ctxloom.telemetry.enabled` is now wired** to actual crash
  reporting (Sentry, via `@ctxloom/core` `captureError`). Off by
  default. Previously the setting toggled nothing — extension
  exceptions vanished silently.
- **`ctxloom.telemetry.level`** mirrors the CLI's three-mode model:
  - `off` (default) — nothing is sent
  - `error` — Sentry crash reports only
  - `all` — reserved for future PostHog usage analytics
- **Universal opt-out env vars honored**: `CTXLOOM_NO_TELEMETRY=1` and
  `DO_NOT_TRACK=1` force `off` regardless of the setting; the Settings
  UI shows "Disabled by environment" when either is set.
- **First-run telemetry notice** — when telemetry is first enabled
  (either via the setting or future opt-in), a one-time VS Code
  notification fires linking to the docs.

---

## [1.1.0] — 2026-05-03

### Changed

- **Lazy CLI download with retry & verification.** Extension no longer
  bundles the CLI tarball; it downloads on first activation, verifies
  the SHA-256 checksum, and retries with backoff on transient
  failures. Drops install size by ~80 MB on disk.

---

## [1.0.0] — 2026-04-27

### Added

- Initial public release (sideload-only).
- LSP-style features: hover, diagnostics, gutter decorations, code
  lens, quick fixes, MCP bridge.
- Settings panel webview with sections for license, features,
  performance, display, telemetry, and advanced configuration.
- Status bar integration showing license state.
- Dashboard URL link (default `http://localhost:7842`).
