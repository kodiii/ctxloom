# Changelog

All notable changes to the **ctxloom VS Code extension** are documented
here. The extension versions independently from the ctxloom CLI
(`ctxloom-pro` on npm); see the [root CHANGELOG](../../CHANGELOG.md)
for CLI release notes.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [1.2.0] — 2026-05-14

### Added

- **Command palette: `ctxloom: Install PR-bot workflow`** — drops
  `.github/workflows/ctxloom-review.yml` into the current workspace
  (shells out to the CLI's `install-pr-bot` command). Requires the
  ctxloom CLI to be installed and on PATH. Shows a VS Code notification
  with the result.
- **README and Settings panel link to [`docs/TELEMETRY.md`](../../docs/TELEMETRY.md)** —
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
