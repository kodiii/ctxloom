# VS Code Extension v1.1 — CLI Lazy-Download Design Spec

**Date:** 2026-04-27
**Status:** Approved for planning
**Predecessor:** [v1 spec (2026-04-25)](./2026-04-25-vscode-extension-design.md), [v1 plan (2026-04-26)](../plans/2026-04-26-vscode-extension.md), [v1 ship PR #13](https://github.com/kodiii/ctxloom/pull/13)

## Goal

Reduce the ctxloom VS Code extension VSIX from 108 MB → ~5 MB so it can be published to the VS Code Marketplace and OpenVSX. Achieve this by stopping the bundling of `ctxloom-pro` inside the VSIX and instead downloading platform-specific CLI tarballs from GitHub Releases on first activation. Replicates the lazy-download pattern used by Sourcegraph Cody and GitHub Copilot.

## Non-Goals

- **Windows support** — deferred to v1.2. v1.1 ships darwin-arm64, darwin-x64, linux-x64, linux-arm64 only. On Windows (`process.platform === 'win32'`) the install modal does NOT appear; activation completes immediately, providers stay unregistered, and the status bar shows `ctxloom: Windows support coming in v1.2` with a click action that opens a tracking issue. WSL users running VS Code from inside WSL get the linux-x64 tarball naturally (their `process.platform === 'linux'`).
- **Resumable downloads.** A failed 150 MB download retries from scratch. Range-request resume can come in v1.2 if support load suggests it matters.
- **Mirror / fallback CDN.** GitHub Releases is the single source of truth.
- **Background updates.** When the extension updates with a new `ctxloomCliVersion`, the install runs the next time the user opens VS Code with the extension active. No background fetching.
- **Sigstore / cosign signature verification.** SHA-256 checksum is sufficient for v1.1's threat model; sigstore can be layered on later without breaking the existing checksum check.
- **Cross-fork CLI sharing.** Each VS Code fork (Cursor, Windsurf, etc.) has its own `globalStorage` and its own copy of the CLI. ~400 MB per fork. Solving this is out of scope.

## Scope decisions (locked during brainstorming)

| Decision | Choice | Reason |
|---|---|---|
| CLI source | **GitHub Releases** | Free CDN-grade hosting, signed by GitHub, matches Cody/Sourcegraph pattern, zero infra cost |
| Versioning | **Pin exact `ctxloomCliVersion` in extension manifest** | Deterministic — every extension version maps to exactly one CLI version. Reproducible bug reports. |
| Download UX | **Blocking modal + `withProgress` notification** | Familiar (Cody/Copilot use this). One-time 30–90s wait is expected on intentional install. |
| Integrity | **SHA-256 checksum sidecar** | 80% of supply-chain protection at 5% of sigstore's complexity. Composes well if we add sigstore later. |
| Platforms | **darwin-arm64, darwin-x64, linux-x64, linux-arm64** | ~90% of pro dev market. Windows in v1.2 with proper testing. |

## Architecture

### Workspace layout (changes from v1)

```
apps/vscode-extension/
├── package.json                       ← + "ctxloomCliVersion": "1.0.5"
├── scripts/
│   ├── prepare-bundle.mjs             ← REMOVED
│   └── build-cli-tarballs.mjs         ← NEW: builds + checksums per-platform tarballs
├── src/
│   ├── extension.ts                   ← orchestrates install before startServer()
│   └── client/
│       ├── BinaryResolver.ts          ← extended: globalStorage lookup; bundled-path lookup removed
│       ├── CliInstaller.ts            ← NEW: download + verify + extract + version-track
│       ├── ServerManager.ts           ← unchanged
│       └── tools.ts                   ← unchanged
└── resources/
    └── icons/                         ← only icons remain — no bundled CLI

.github/workflows/
├── build-extension.yml                ← drops prepare-bundle step; ~5 MB VSIX artifact
├── publish-extension.yml              ← marketplace + OpenVSX publish steps re-enabled
└── publish-cli-tarballs.yml           ← NEW: matrix build of platform tarballs
```

### Module boundaries

- **`CliInstaller`** is the only thing that touches network, checksums, tarball extraction, and `globalStorageUri`. Public surface: `ensureInstalled(version: string): Promise<{ path: string }>` + `dispose()`. Idempotent — it does nothing if the right version is already on disk.
- **`BinaryResolver`** stays a pure-logic resolver — pure path-existence checks only. Lookup priority: `override` → `globalStorageRoot/ctxloom-cli/<version>/dist/index.js` (returns the path with `exists: true|false`) → `null`. It does NOT read `INSTALLED_VERSION`; that's `CliInstaller`'s responsibility, which guarantees the directory only exists if the install committed successfully.
- **`extension.ts`** activation sequence: license gate → `CliInstaller.ensureInstalled()` (if needed) → `ServerManager.start()`. If install fails or is skipped, providers stay unregistered exactly like v1's "CLI missing" path.

### Public exports (none)

`CliInstaller` is internal to the extension package. No new public exports across workspace boundaries.

## Versioning model

### Two release tag families

| Tag pattern | Triggers | Produces |
|---|---|---|
| `cli-v1.0.5` | `publish-cli-tarballs.yml` | 4 platform tarballs + 4 SHA-256 sidecars on GitHub Release `cli-v1.0.5` |
| `vscode-v1.1.0` | `publish-extension.yml` | VSIX → Marketplace + OpenVSX + GitHub Release `vscode-v1.1.0` |

Decoupling lets us:
- **CLI hotfix without extension republish:** tag `cli-v1.0.6`, push tarballs. Then bump `ctxloomCliVersion` and tag `vscode-v1.1.1` to deliver it. Two tags, but the extension version is what users see.
- **Extension UI fix without CLI republish:** bump VSCE version only. `ctxloomCliVersion` unchanged → existing on-disk install reused, no re-download.

### Manifest field

```jsonc
// apps/vscode-extension/package.json
{
  "name": "ctxloom-vscode",
  "version": "1.1.0",
  "ctxloomCliVersion": "1.0.5",        // MUST match a published cli-vX.Y.Z release tag
  "publisher": "ctxloom",
  ...
}
```

### Download URLs

```
https://github.com/kodiii/ctxloom/releases/download/cli-v${cliVersion}/ctxloom-cli-${cliVersion}-${platform}.tar.gz
https://github.com/kodiii/ctxloom/releases/download/cli-v${cliVersion}/ctxloom-cli-${cliVersion}-${platform}.tar.gz.sha256
```

`platform` ∈ `{darwin-arm64, darwin-x64, linux-x64, linux-arm64}`.

### Compatibility check

On every activation, `CliInstaller` reads `${globalStorage}/INSTALLED_VERSION` (single line containing the installed CLI version):

- Absent or content !== `ctxloomCliVersion` → trigger install flow
- Matches → resolve binary path, skip download, proceed to `ServerManager.start()`

No semver-range checking. Full pinning is the design rule.

## Download flow

### State machine

```
extension.activate()
  │
  ├─ check ${globalStorage}/INSTALLED_VERSION
  │    ├─ matches → skip to ServerManager.start()
  │    └─ missing or mismatch → CliInstaller.ensureInstalled()
  │
  ├─ INSTALL FLOW (CliInstaller.ensureInstalled):
  │    ├─ if ctxloom.cli.installPromptDismissed === true → leave inert, register status-bar
  │    │
  │    ├─ confirm with modal (Install / Skip for now / Don't ask again)
  │    │
  │    ├─ withProgress({ location: Notification, cancellable: true }):
  │    │    ├─ resolve platform via process.platform + process.arch
  │    │    ├─ download .tar.gz.sha256 (small, ~70 bytes)
  │    │    ├─ download .tar.gz with progress (~150 MB / 30–90s)
  │    │    ├─ verify SHA-256 (compute over downloaded bytes, compare)
  │    │    ├─ extract to ${globalStorage}/tmp/staging-<v>/
  │    │    ├─ fs.rename(staging-<v>, ctxloom-cli/<v>/)         ← atomic on POSIX
  │    │    ├─ fs.writeFileSync(INSTALLED_VERSION, "<v>")        ← the "commit"
  │    │    ├─ delete tmp tarball
  │    │    └─ delete ctxloom-cli/<oldVersion>/ if any
  │    │
  │    └─ on any failure: cleanup, surface error toast, leave inert
  │
  └─ on success: continue to ServerManager.start()
```

### Modal copy

```
ctxloom needs to download its analyzer

One-time download, ~150 MB. Includes language grammars, vector index,
and embedding model. Stored at <globalStorageUri>.

[ Install ]  [ Skip for now ]  [ Don't ask again ]
```

- **Install** → standard happy path
- **Skip for now** → deferred this session; modal re-appears next activation
- **Don't ask again** → writes `ctxloom.cli.installPromptDismissed: true` setting. Reset via Settings panel "Re-prompt CLI install" button or the `ctxloom: Install CLI` command

### Progress notification

`vscode.window.withProgress({ location: Notification, cancellable: true })` with these messages:

- "Downloading ctxloom analyzer (X% of 150 MB)" during fetch
- "Verifying download…" during SHA-256 check
- "Installing…" during extract + rename
- Auto-dismisses on success; converts to error toast on failure

### Status-bar interaction during install states

| State | Status-bar text | Click action |
|---|---|---|
| Installing | `ctxloom: installing… X%` | (no-op while in progress) |
| Skipped | `ctxloom: setup needed` | re-runs install modal |
| Failed | `ctxloom: setup failed — see Output` | opens the OutputChannel |
| Installed | (normal license + risk display from v1) | opens Settings panel (v1 behavior) |

## Storage layout

`vscode.ExtensionContext.globalStorageUri` is the only persistent location. VS Code resolves per-OS:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Code/User/globalStorage/ctxloom.ctxloom-vscode/` |
| Linux | `~/.config/Code/User/globalStorage/ctxloom.ctxloom-vscode/` |

VS Code automatically cleans up this directory when the user uninstalls the extension.

### Layout

```
${globalStorageUri}/
├── INSTALLED_VERSION              ← single line, e.g. "1.0.5"
├── ctxloom-cli/                   ← all installed CLI versions
│   └── 1.0.5/                     ← matches CLI version, never overwritten in place
│       ├── dist/
│       │   └── index.js           ← the entry BinaryResolver looks for
│       ├── node_modules/
│       └── package.json
└── tmp/                           ← scratch space for downloads + extraction
    └── ctxloom-cli-1.0.5-darwin-arm64.tar.gz   (deleted after extraction)
```

### Atomic install (idempotent across crashes)

```
1. Download tarball to ${globalStorage}/tmp/ctxloom-cli-<v>-<plat>.tar.gz
2. Verify SHA-256 → if fail, delete tmp file, abort
3. Extract into ${globalStorage}/tmp/staging-<v>/
4. fs.rename(tmp/staging-<v>, ctxloom-cli/<v>/)        ← atomic on POSIX
5. fs.writeFileSync(INSTALLED_VERSION, "<v>")           ← the "commit"
6. Delete tmp/ctxloom-cli-<v>-<plat>.tar.gz
7. Delete ctxloom-cli/<oldVersion>/ if different from <v>
```

If the extension crashes between steps 4 and 5, `INSTALLED_VERSION` doesn't yet exist (or still points at the previous version) — next activation re-triggers install, finds the staged directory present, runs idempotently.

If it crashes between steps 1 and 4, `tmp/` is cleaned up at install entry on the next activation (any `tmp/staging-*` dirs are deleted before retry).

### `BinaryResolver` updates

```typescript
export interface ResolveOptions {
  globalStorageRoot: string;        // NEW — passed from extension.ts
  cliVersion: string;               // NEW — from manifest
  override: string | null;          // unchanged
}

// Lookup priority (no version-file read — pure existence check):
//   1. override (if set, used regardless of existence; user opts out of lazy install)
//   2. globalStorageRoot/ctxloom-cli/<version>/dist/index.js (returned with exists: true|false)
//   3. CliInstaller.ensureInstalled() runs whenever the path doesn't exist
```

The `extensionRoot` field and `BUNDLED_SUBPATH` constant are removed.

### Disk-space hygiene

After successful install of a new version, the previous version directory is deleted. Worst-case footprint: ~400 MB during the brief moment both exist between steps 4 and 7. Steady state: ~400 MB.

## Failure handling

| Failure | Detection | User-facing | Recovery |
|---|---|---|---|
| Network unreachable | `fetch` rejects with ENOTFOUND/ETIMEDOUT | Toast: "Couldn't reach GitHub. [Retry] [Skip for now] [Open Output]" | Retry uses fresh AbortController + fetch. Skip → status bar `ctxloom: setup needed` |
| HTTP 404 (asset missing) | Status check on download response | Toast: "ctxloom CLI v1.0.5 was not found. [Open Issue] [Open Output]" | "Open Issue" pre-fills bug report. No auto-retry. |
| HTTP 5xx | Status check | Toast: "GitHub returned 503. [Retry in 30s] [Skip for now]" | Auto-retry once after 30s with exponential backoff |
| HTTP 403 / rate-limited | `x-ratelimit-remaining: 0` | Toast: "GitHub rate-limited. Try again in N minutes. [Skip for now]" | N from `x-ratelimit-reset`. No auto-retry. |
| Disk full / write failure | `fs` errors | Toast: "Couldn't write to globalStorage: <reason>. [Open Output]" | No auto-retry. Output shows path + free-space hint. |
| SHA-256 mismatch | Hash mismatch vs sidecar | Toast: "Download failed integrity check. [Retry] [Open Output]" | Cleanup partial files. Retry = full re-download. |
| Extraction failure | `tar` exits non-zero | Toast: "Couldn't extract analyzer. [Retry] [Open Output]" | Same as SHA mismatch — full re-download, fresh extract. |
| Cancelled by user | `AbortController.abort()` | No toast — silent return | Status bar shows `setup needed`; user clicks to retry |
| Process killed mid-install | Detected on next activation | (none on the failing run) | `CliInstaller.ensureInstalled` deletes orphaned `tmp/staging-*` on entry |

### Retry budget

Session-scoped counter prevents retry storms:

- Each "Retry" click counts as one attempt
- After 3 failures in one VS Code session, the toast changes to "ctxloom couldn't install after 3 attempts. [Open Output]" — no more retry button. User restarts VS Code or runs `ctxloom: Install CLI` to reset.

### Recovery via existing command

`ctxloom: Restart Server` (already present in v1) is extended:

- When invoked, first checks `INSTALLED_VERSION` against the manifest
- If mismatch → triggers `CliInstaller.ensureInstalled()` (with the modal)
- If match → existing server-restart logic

This means: any failure recovers via one well-known command, not several specialized ones.

### Two new commands

| Command | Purpose |
|---|---|
| `ctxloom: Install CLI` | Manually trigger install flow. Useful if user clicked "Don't ask again" and changed their mind. |
| `ctxloom: Show CLI Install Path` | Information message with full path to `${globalStorage}/ctxloom-cli/<version>/`. Useful for support tickets. |

## Build pipeline

### `apps/vscode-extension/scripts/build-cli-tarballs.mjs`

Replaces v1's `prepare-bundle.mjs`. Logic:

```
for platform in [darwin-arm64, darwin-x64, linux-x64, linux-arm64]:
  build ctxloom-pro (cached on subsequent platforms)
  npm pack
  extract to tmp dir
  npm install --omit=dev --ignore-scripts
  prune onnxruntime-node binaries for OTHER platforms
  tar -czf dist-cli/ctxloom-cli-<v>-<platform>.tar.gz <staged-dir>
  shasum -a 256 ... > dist-cli/ctxloom-cli-<v>-<platform>.tar.gz.sha256
write dist-cli/manifest.json with version + platform list
```

**Cross-platform builds**: rather than cross-installing native deps via `npm_config_target_*` env vars, the publish workflow runs the build job on multiple matrix runners (`macos-14`, `macos-13`, `ubuntu-22.04`, `ubuntu-22.04-arm`). Each runner builds its native tarball.

The script accepts `--platform=<name>` to limit to a single platform when invoked from CI matrix; running without the flag builds whichever platform the host runner can natively (used during local dev).

### `.github/workflows/publish-cli-tarballs.yml` (new)

```yaml
name: publish-cli-tarballs
on: { push: { tags: [ 'cli-v*' ] } }
jobs:
  build:
    strategy:
      matrix:
        include:
          - { os: macos-14,         platform: darwin-arm64 }
          - { os: macos-13,         platform: darwin-x64 }
          - { os: ubuntu-22.04,     platform: linux-x64 }
          - { os: ubuntu-22.04-arm, platform: linux-arm64 }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: cd apps/vscode-extension && node scripts/build-cli-tarballs.mjs --platform=${{ matrix.platform }}
      - uses: actions/upload-artifact@v4
        with:
          name: cli-${{ matrix.platform }}
          path: apps/vscode-extension/dist-cli/*

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { path: dist-cli, pattern: cli-* }
      - uses: softprops/action-gh-release@v2
        with:
          files: dist-cli/**/ctxloom-cli-*.tar.gz*
          tag_name: ${{ github.ref_name }}
```

### `.github/workflows/build-extension.yml` (modified)

Drop the `prepare-bundle.mjs` step. The PR-CI now:

1. Lint
2. Unit tests (vitest)
3. Integration tests with a fixture CLI (see Testing)
4. Package VSIX (~5 MB)
5. Upload as workflow artifact

### `.github/workflows/publish-extension.yml` (modified)

Re-enable the marketplace + OpenVSX publish steps that v1 left commented out:

```yaml
- run: cd apps/vscode-extension && npx vsce publish --packagePath ctxloom-vscode.vsix
  env: { VSCE_PAT: '${{ secrets.VSCE_PAT }}' }
- run: cd apps/vscode-extension && npx ovsx publish ctxloom-vscode.vsix
  env: { OVSX_PAT: '${{ secrets.OVSX_PAT }}' }
```

VSIX is now within Marketplace's 50 MB limit.

### Release flow (maintainer-facing)

1. CLI change merged to main with `ctxloom-pro` version bump (e.g., 1.0.5 → 1.0.6). Tag `cli-v1.0.6`. Workflow runs, uploads 4 platform tarballs + 4 sidecars to GitHub Release `cli-v1.0.6`.
2. Bump `ctxloomCliVersion` in `apps/vscode-extension/package.json` to `1.0.6`. Bump VSCE `version` (e.g., 1.1.0 → 1.1.1). Tag `vscode-v1.1.1`. Workflow runs, publishes 5 MB VSIX to Marketplace + OpenVSX + GitHub Release.
3. Users update via VS Code's auto-update. Next activation triggers install modal for the new CLI version.

## Testing strategy

### Layer 1 — Unit tests (vitest, `tests/unit/`)

**`tests/unit/CliInstaller.test.ts`** (~10 tests). Pure-logic + filesystem against tmpdir. Stubs `fetch` via `vi.fn()` returning canned `Response` objects.

- Happy path: download → verify → extract → write `INSTALLED_VERSION`
- 404 handling
- 5xx with retry
- SHA mismatch path
- Cancellation via `AbortController`
- Disk-full simulation (mock `fs.write` to reject)
- Idempotent on stale `tmp/staging-*` dirs
- Old-version cleanup after new install
- Skip-for-now state respects `ctxloom.cli.installPromptDismissed`
- Don't-ask-again setting persistence

**`tests/unit/BinaryResolver.test.ts`** — extended with 3 new tests for the `globalStorageRoot + cliVersion` lookup path (priority over bundled, falls through when version mismatches).

### Layer 2 — Integration tests (`@vscode/test-electron`, `tests/integration/`)

The existing v1 integration suite continues to pass — those tests use stubbed `Tools` so they don't depend on a real CLI.

Two new integration test files:

**`tests/integration/CliInstaller.test.ts`** (~5 tests) — exercises install flow end-to-end using a `file://` URL pointing at a fixture tarball, against a real `globalStorage` provided by VS Code's test harness.

- Modal appears when `INSTALLED_VERSION` is missing
- Modal does NOT appear when version matches
- "Skip for now" sets the deferred state and skips this session's install
- "Don't ask again" persists the setting and skips future sessions until reset
- Successful install populates `globalStorage/ctxloom-cli/<version>/` and writes `INSTALLED_VERSION`

**`tests/integration/Activation.test.ts`** (~3 tests) — verifies activation orchestration:

- First-activation-without-CLI shows the modal
- "Skip for now" leaves status bar in `setup needed` state, providers unregistered
- Existing-CLI activation skips the modal and reaches `ServerManager.start()`

**`tests/fixtures/fake-cli/`** — a tiny no-op MCP server (~50 lines of TS) compiled at test time. Pre-packed as a tarball that `CliInstaller` tests can install via `file://` URLs. Responds to `ctx_status` so `ServerManager.start()` succeeds.

### Layer 3 — Smoke test (`tests/smoke/`, runs on tag-publish CI only)

Replaces v1's "real bundled CLI" smoke. New version exercises the actual download path:

- Sets a hidden `ctxloom.cli.testReleaseTag` setting so the installer fetches from a known-good release tag (`cli-v0.0.0-test`) instead of the manifest version
- Asserts that `CliInstaller.ensureInstalled` performs the network round-trip, verifies SHA, extracts, and the resulting CLI responds to `ctx_status`
- Only test that hits real GitHub. ~30s wall time.
- Catches regressions in URL construction, signing, 404 handling

A small fixture tarball is published to GitHub Releases tag `cli-v0.0.0-test` and maintained as part of the repo's CI infrastructure.

**Prerequisite for the smoke test:** the `cli-v0.0.0-test` release tag must be created and populated with a tiny fixture tarball before the smoke test can pass. This is a one-time release-engineering setup step, not part of the implementation; it's tracked as a release-prep task that lands ahead of v1.1 publication.

### Coverage target

≥85% on `client/`, `license/`, `shared/`, `settings/` (unchanged from v1). The new `CliInstaller.ts` (~200 lines) gets ~10 unit + 5 integration tests, easily clearing 85%.

### Out of scope for tests

- **Cross-platform tarball download** in CI. The matrix-build job tests *building* tarballs on each platform; the *download* test runs on Linux only.
- **Marketplace + OpenVSX publish** beyond a dry-run check on tag-push. Real publish only happens for production tags.

## Migration & backwards compatibility

- **Existing v1 users** who installed via VSIX sideload: when v1.1 is published, VS Code's auto-update fetches the new VSIX. On next activation, the install modal appears for the new CLI version. The old `resources/ctxloom-cli/` is gone after the update; it lived inside the VSIX bundle which VS Code replaces atomically.
- **License storage** at `~/.config/ctxloom/license.json` is shared across CLI/dashboard/extension and is unaffected.
- **`ctxloom.cliPath` setting** still works — users with a globally-installed `ctxloom-pro` can continue to use it. `BinaryResolver` checks override first.
- **CI artifacts**: existing `ctxloom-vscode-vsix` artifact uploads in `build-extension.yml` keep working; they're just much smaller.
- **`ctxloom.cliPath` config schema unchanged** — users with override set continue to work identically. New `ctxloom.cli.installPromptDismissed` config key added in v1.1; safe default `false`.

## Success criteria

- VSIX size ≤ 10 MB
- Marketplace publish succeeds (no size violation)
- First-activation install completes in ≤ 90 s on broadband (GitHub Releases CDN)
- Subsequent activations have zero install latency (skip path takes < 50 ms)
- All v1 integration tests still pass
- New CliInstaller unit tests ≥ 10, integration tests ≥ 5, smoke test passes on tag-publish
- Polite Windows fallback ("Coming in v1.2") on `process.platform === 'win32'`
- "Skip for now" state recoverable via Settings panel and `ctxloom: Restart Server`
- `ctxloom: Restart Server` triggers re-install when `INSTALLED_VERSION` mismatches
