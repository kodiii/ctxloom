# VS Code Extension — Design Spec

**Date:** 2026-04-25
**Status:** Approved for planning
**Predecessor:** Phase 1, tasks 1.11–1.15 of the ctxloom roadmap; "IDE Extension" addon in `docs/future_features.md` (Tier 1, Priority pick #2)
**Depends on:** Completed `packages/core` extraction (spec 2026-04-24), `@ctxloom/mcp-client` package, `packages/core/src/license/` Polar-backed license module

## Goal

Ship a single VS Code extension (compatible with VS Code, Cursor, Windsurf, and other forks via OpenVSX) that exposes ctxloom's hybrid AST + git + graph data inside the editor. Eleven features, all built on top of the existing MCP toolkit. Built ready-to-ship now; rolled out 2–3 weeks after `ctxloom-pro` product launch.

## Non-Goals

- **Multi-root workspaces** in v1 — single-folder workspaces only. Multi-root logged in `docs/future_features_vscode.md`.
- **Daemon mode** — extension always spawns its own ctxloom child process per VS Code window.
- **JetBrains port** — separate plugin, shares no code. Tracked in the future-implementations log.
- **Inline AI suggestions** — Copilot's surface, not ours.
- **GitLens-style blame UI** — out of scope.
- **Settings UI for rules config** — use the `ctxloom rules` CLI; deferred.
- **Web-extension build** for github.dev / vscode.dev — deferred, requires a separate bundle that doesn't ship native deps.

## Scope decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Server lifecycle | **Extension spawns per-workspace** via `mcp-client.spawnServer({ cwd })` | Matches every successful VS Code extension's onboarding model (Copilot, Cody, Continue, GitLens). Zero CLI install required from the user. |
| CLI discovery | **Bundled inside the VSIX** at `resources/ctxloom-cli/` | Eliminates PATH issues on macOS GUI launches. ~26 MB total VSIX, comfortably below Cody (80 MB) and Copilot (30 MB). |
| License gating | **Fully gated, same Polar-backed flow as the CLI** | Aligns with ctxloom-pro's commercial model. Single license file at `~/.config/ctxloom/license.json` shared across CLI / dashboard / extension. |
| Workspace boundaries | **Single-root only** (`workspaceFolders[0]`) | ~95% of VS Code users work in single-root. Multi-root adds 1.5 days for a feature most users don't need. |
| Marketplace targets | **VS Code Marketplace + OpenVSX + GitHub Releases (VSIX artifact)** | Same VSIX in all three. OpenVSX covers Cursor/Windsurf which dominate AI-tooling early adopters. |

## Architecture

### Workspace layout

```
apps/vscode-extension/
├── package.json                   ← VS Code manifest (contributes, activation events)
├── tsconfig.json
├── esbuild.config.mjs             ← bundles src/ → dist/extension.js (CJS, single file)
├── scripts/
│   └── prepare-bundle.mjs         ← copies ctxloom-pro into resources/ctxloom-cli/
├── src/
│   ├── extension.ts               ← activate() / deactivate() lifecycle
│   ├── client/
│   │   ├── ServerManager.ts       ← spawns + wraps mcp-client; owns retry / reconnect
│   │   ├── BinaryResolver.ts      ← finds bundled ctxloom; respects `ctxloom.cliPath` override
│   │   └── tools.ts               ← typed wrappers around the 9 MCP tools we use
│   ├── license/
│   │   ├── LicenseGate.ts         ← orchestrates trial / activate / expiry UX
│   │   └── statusBar.ts           ← status-bar item: license + file risk
│   ├── settings/
│   │   ├── SettingsPanel.ts       ← branded webview: License + Features + Performance + Display + Telemetry + Advanced
│   │   ├── webview/               ← static HTML/CSS/JS bundle (Tailwind tokens shared with dashboard)
│   │   │   ├── index.html
│   │   │   ├── main.ts            ← React-free, vanilla TS for fast load
│   │   │   └── styles.css
│   │   └── messageProtocol.ts     ← typed messages between extension host and webview
│   ├── providers/
│   │   ├── HoverProvider.ts       ← feature 1
│   │   ├── DiagnosticsProvider.ts ← feature 2
│   │   ├── BlastRadiusView.ts     ← feature 4
│   │   ├── CodeHealthView.ts      ← feature 5
│   │   ├── GutterDecorations.ts   ← feature 8
│   │   ├── CodeLensProvider.ts    ← feature 9
│   │   ├── QuickFixProvider.ts    ← feature 10
│   │   └── McpBridge.ts           ← feature 11
│   ├── commands/
│   │   └── index.ts               ← all command handlers
│   └── shared/
│       ├── debounce.ts            ← shared editor-event debouncer
│       ├── cache.ts               ← per-file 30s TTL cache
│       └── logger.ts              ← VS Code OutputChannel logger
├── resources/
│   ├── ctxloom-cli/               ← .gitignore'd; populated at build time
│   └── icons/
└── tests/
    ├── unit/                      ← vitest, no VS Code API
    ├── integration/               ← @vscode/test-electron with stubbed ServerManager
    ├── smoke/                     ← @vscode/test-electron with real CLI
    └── fixtures/workspace-a/      ← deterministic TS files for tests
```

### Module boundaries

- **`ServerManager`** is the *only* class that talks to the ctxloom child process. Every provider, view, and command consumes it via dependency injection. Swapping to a daemon model later is a one-file change.
- **Providers are stateless.** They call `ServerManager.callTool(name, args)` and render. State (diagnostics, tree-view nodes, decorations) lives in VS Code's own collections (`DiagnosticCollection`, `TreeDataProvider`, `setDecorations`).
- **License gate** wraps every provider/command activation. One gate, one webview, one source of truth. License state changes trigger provider register/unregister cleanly.
- **Bundled CLI** is a build-time concern. `BinaryResolver` reads `__dirname/../resources/ctxloom-cli/dist/index.js` and spawns it. Users can override with `ctxloom.cliPath` setting if they prefer their global install.

### Public exports (none)

This package is workspace-private. It does not export anything to other workspace packages — it is a leaf consumer of `@ctxloom/mcp-client` and (transitively) `@ctxloom/core` types.

## The 11 features

| # | Feature | Trigger | MCP tool used | Behavior |
|---|---|---|---|---|
| 1 | **Hover cards** | Hovering an import path or filename in any code file | `ctx_risk_overlay`, `ctx_blast_radius` (count only) | Inline card: top-3 owners, risk score (color-coded badge), blast count (`↗ 12 files`), link to dashboard |
| 2 | **Rules diagnostics** | File open / save | `ctx_rules_check --file=<active>` | Each violation → `vscode.Diagnostic` in the Problems panel with severity from rule config |
| 3 | **Status bar** | Always visible | `ctx_risk_overlay` for active file | `⚠ 0.42` color-coded by threshold; click → opens dashboard `/risk?file=…` |
| 4 | **Blast Radius panel** | Side-bar view, refreshes on active editor change | `ctx_blast_radius --file=<active>` | Tree: `Direct importers (3) → Transitive (12) → Historical coupling (5)`. Click any node → opens that file. |
| 5 | **Code Health panel** | Side-bar view, manual refresh | `ctx_knowledge_gaps`, `ctx_hub_nodes`, `ctx_community_list` (counts) | Workspace summary with three nodes: `Dead code (12)`, `Hub files (8)`, `Communities (5)`. Each expands to top-N items. Bottom: "Open in Dashboard →" link. |
| 6 | **Command palette** | `Ctrl+Shift+P` | various | Six commands: `Show Blast Radius`, `Show Owners`, `Generate Context Packet`, `Refresh Code Health`, `Show License Status`, `Open Dashboard` |
| 7 | **Code Lens** (top of file) | All editors, on file open | cached call to `ctx_risk_overlay` | One-line: `↓3 importers · risk 0.42 · @alice · [↗ Copy AI context]` |
| 8 | **Gutter decorations** | All editors, debounced 250 ms after edits | `ctx_git_coupling` (per-file churn buckets) | Colored gutter strip: red (high churn), orange (medium), blue (low). Dead-code marker in top-right gutter for files with 0 importers. |
| 9 | **Code Lens — Copy AI Context** | Above each top-level function/class | `ctx_get_context_packet --symbol=<…>` | Click → skeletonized context (purpose + signatures + minimal body) copied to clipboard, ready to paste into Copilot Chat / Cursor / Claude. Toast: `Copied 1.2k tokens (92% reduced)`. |
| 10 | **Rules quick-fixes** | Diagnostic from #2 has a `quickFix` action | `ctx_apply_refactor` | Light-bulb action on violation → applies the suggested refactor. User confirms before file changes. |
| 11 | **MCP bridge** | Activation, if VS Code MCP API present | spawnServer + `vscode.lm.registerMcpServerProvider` (1.95+) | Auto-registers ctxloom as an MCP server in the user's VS Code MCP registry. Copilot Chat / Cursor / Continue can call `ctx_*` tools directly. Falls back silently if API not available. |

### Cross-cutting concerns

- **Caching:** `ctx_risk_overlay` and `ctx_get_call_graph` results cached in-memory per file with a 30 s TTL. Cache invalidates on file save in that file. Without this, hover + status bar + code lens + gutter would each fire one call per 250 ms cursor move — unusable.
- **Debouncing:** All editor-event-driven providers (gutter, status bar, code lens) share `shared/debounce.ts` with a 250 ms default. User-configurable via `ctxloom.debounceMs`.
- **Editor compatibility:** Built against the VS Code API surface stable in 1.85+. Feature 11 feature-detects `vscode.lm.registerMcpServerProvider` — present in VS Code 1.95+, Cursor 0.42+, Windsurf nightly. Other 10 features unaffected if the API isn't there.

### Differentiation rationale

The MCP bridge (#11) and the per-symbol "Copy AI context" lens (#9) are the two features competitors can't easily match:

- **#11** turns ctxloom into the default code-context provider for every AI assistant the user already has installed. Distribution moat.
- **#9** is unique because skeletonization (92 % token reduction) is unique. It makes ctxloom the best context provider for whatever AI coding tool the user is already using.

The other 9 features close the gap with Sourcegraph Cody / SonarLint / GitLens but on their own would not be enough to displace incumbents.

## License flow & first-run UX

The license gate uses the same Polar-backed flow as the CLI (`packages/core/src/license/`). The license file at `~/.config/ctxloom/license.json` is shared — if a user has activated `ctxloom-pro` CLI on this machine, the extension picks it up automatically with no reactivation.

### Activation sequence

```
extension.activate()
  → ServerManager.start()         // spawn bundled ctxloom child via mcp-client
  → LicenseGate.evaluate()        // calls into license/ — reads ~/.config/ctxloom/license.json
  → branch on result:
       NO_LICENSE       → auto-open Settings panel with License section pre-focused
                          (other sections rendered but disabled, "Activate to enable" overlay)
       TRIALING / active→ register all providers; status bar shows "trial Nd left" or risk score
       expired          → soft-block (all providers unregister; status bar red);
                          clicking status bar reopens Settings panel at License section
       LICENSED         → register all providers, no banner
```

### License activation flow (lives inside the Settings panel — see Section 4)

The license section of the Settings panel is the single surface for activation, trial start, and deactivation. There is no separate first-run webview.

**Path 1 — Start free trial:**
1. User clicks `Start free trial…` in the License section → an inline email input appears.
2. User submits → extension calls `startTrial(email)` from the bundled license module → receives Polar `checkout_url`.
3. Extension opens `checkout_url` in the user's default browser via `vscode.env.openExternal(...)`.
4. License section transitions to a waiting state: "Check your email — your license key is on its way. Paste it here when it arrives." with a key-entry input.
5. User pastes the key → extension calls `activateLicense(key)` → success → all providers register, panel re-renders with the licensed state.

**Path 2 — Activate license key:** clicking `Activate license key…` jumps straight to step 5.

**Path 3 — Auto-detect:** if `~/.config/ctxloom/license.json` is already valid at activation, the panel does not auto-open; status bar simply shows the licensed state.

### Polar-aware error states (already mapped in `ApiClient.ts`)

- `FingerprintAlreadyUsedError` → "A trial was already used on this machine. [Buy →]"
- `EmailAlreadyUsedError` → "A trial was already used for this email. [Buy →]"
- `TrialUnavailableError` (Polar 503) → "Trial service is temporarily unavailable. Try again in a few minutes, or [Buy →]."

### Status-bar item

- Licensed: `⚠ 0.42 · ctxloom`
- Trialing: `⚠ 0.42 · trial 5d`
- Trialing, ≤ 2 d left: `⚠ 0.42 · trial ends Sat` (orange)
- Expired: `ctxloom expired` (red, click → reopens Settings panel at License section, Path 2)

### Soft-block (trial expired / license expired)

- All providers unregister; the extension goes dark.
- Status-bar item turns red: `ctxloom expired`.
- One-click reopens the Settings panel at the License section with the key-entry input pre-focused.
- Output channel logs the expiry reason for support diagnostics.

### License-related commands

- `ctxloom: Activate License Key` — input box for the key, calls `activateLicense`.
- `ctxloom: Start Free Trial` — opens the Settings panel at the License section, Path 1.
- `ctxloom: Show License Status` — shows tier, expiry, fingerprint.
- `ctxloom: Deactivate License` — calls `deactivateLicense` (releases the seat).

### Telemetry policy

- **Default OFF.** Setting `ctxloom.telemetry.enabled` defaults to `false`.
- If opted in, sends extension version, VS Code version, OS, daily active markers, error rates via the existing `track()` from `packages/core/src/license/telemetry.ts`. **Never** code, file paths, or graph data.
- Opt-in flow happens after license activation, on the second day of use, as a non-modal toast: "Help us improve ctxloom? Anonymous usage data only." Decline persists.

## Configuration & settings

All under the `ctxloom.*` namespace. All optional. Defaults work zero-config.

```jsonc
"ctxloom.cliPath": null,                  // string | null — override bundled CLI
"ctxloom.serverArgs": [],                 // string[] — extra args passed to the spawned child
"ctxloom.debounceMs": 250,                // number — shared debounce for editor events
"ctxloom.cacheTtlSeconds": 30,            // number — per-file TTL for risk/call-graph results

"ctxloom.features.hover": true,           // boolean — feature toggles
"ctxloom.features.diagnostics": true,
"ctxloom.features.gutterDecorations": true,
"ctxloom.features.codeLens": true,
"ctxloom.features.quickFixes": true,
"ctxloom.features.mcpBridge": true,

"ctxloom.gutter.churnThresholdHigh": 1000,    // lines added+deleted/year for "high"
"ctxloom.gutter.churnThresholdMedium": 200,   // ditto for "medium"
"ctxloom.gutter.showDeadCodeMarker": true,

"ctxloom.dashboardUrl": "http://localhost:7842",  // URL the status bar / panels link to
"ctxloom.telemetry.enabled": false        // see License flow section
```

`features.*` lets enterprises disable subsystems via `.vscode/settings.json` checked into the repo.

### Settings UX — branded ctxloom panel (single source of truth)

A custom webview panel — `ctxloom: Settings` — is the primary settings surface, with native VS Code Settings UI as a redundant fallback for power users / IT departments that automate via `.vscode/settings.json`.

**Why a branded panel:** ctxloom is a paid product and the editor surface is the highest-value touchpoint. A polished sectioned UI (matching the dashboard's Tailwind tokens) signals product quality and gives room for explanatory copy, status indicators, and the license activation flow in one place. It also subsumes the standalone activation webview from Section 3 — instead of two webview surfaces ("first-run activation" + "settings"), there is one.

**Where it lives:**
- A "ctxloom" view container in the Activity Bar (left edge) groups three views: Blast Radius, Code Health, and a "Settings & License" tree-view button at the top of the container that opens the full panel as a webview tab
- Command palette: `ctxloom: Open Settings`
- Status-bar item click: opens the panel
- First run with no license: panel auto-opens with the License section pre-focused; all other sections rendered but disabled with "Activate to enable" overlay

**Panel sections (top to bottom):**

```
┌─ ctxloom Settings ──────────────────────────────────────────┐
│                                                              │
│  ▸ License                                                   │
│    Tier: Pro · Trialing · 5 days left                        │
│    Fingerprint: 7a3f…b21c                                    │
│    [ Activate license key… ]   [ Start free trial… ]         │
│    [ Deactivate this seat ]                                  │
│                                                              │
│  ▸ Features                                                  │
│    [✓] Hover cards                                           │
│    [✓] Rules diagnostics                                     │
│    [✓] Gutter decorations                                    │
│    [✓] Code lens                                             │
│    [✓] Rules quick-fixes                                     │
│    [✓] MCP bridge for AI assistants  ⓘ requires VS Code 1.95+│
│                                                              │
│  ▸ Performance                                               │
│    Debounce ........................ [ 250 ] ms              │
│    Cache TTL ....................... [  30 ] s               │
│                                                              │
│  ▸ Display                                                   │
│    Gutter churn threshold (high) ... [ 1000 ] lines/yr       │
│    Gutter churn threshold (medium) . [  200 ] lines/yr       │
│    [✓] Show dead-code marker in gutter                       │
│    Dashboard URL ................... [ http://localhost:… ]  │
│                                                              │
│  ▸ Telemetry                                                 │
│    [ ] Send anonymous usage data                             │
│    Read our privacy policy →                                 │
│                                                              │
│  ▸ Advanced                                                  │
│    Custom CLI path ................. [          (bundled) ]  │
│    Server args (JSON array) ........ [ []                 ]  │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│  Open in VS Code Settings →    Restart server    Open Output│
└──────────────────────────────────────────────────────────────┘
```

**Reactivity & sync:** the panel is a thin view over `vscode.workspace.getConfiguration('ctxloom')`. On open: read every value and render. On change in panel: call `update()` on the configuration. On `onDidChangeConfiguration` from any external source (Settings UI, `.vscode/settings.json` edit, sync from another window): re-render the panel if mounted. Native VS Code Settings UI continues to work — both surfaces edit the same underlying configuration.

**Provider lifecycle (unchanged from the simpler design):** every provider's lifecycle is gated by its `features.<name>` setting. When a feature flips off (from either surface), its `dispose()` is called, decorations / diagnostics / hover registrations are cleared, cached data is dropped. When it flips back on, the provider re-registers with a fresh state.

**License section UX details:**
- `Activate license key…` button → input within the panel (no separate webview), calls `activateLicense(key)`. Errors render inline below the input.
- `Start free trial…` button → inline email input → `startTrial(email)` → opens Polar checkout in default browser → panel transitions to a "Waiting for your license key…" state with a paste-key input.
- `Deactivate this seat` button → confirmation dialog → `deactivateLicense()` → all providers unregister, panel re-renders with NO_LICENSE state.
- Status indicators inline: green dot for active, amber for trialing, red for expired.

**Native VS Code Settings UI is still wired** via `package.json`'s `contributes.configuration`. Users with strong "I prefer settings.json" workflows are unaffected. The custom panel is the primary surface; native settings is the redundant power-user one.

**Build cost:** ~2 days vs. the previous A+B option. Brings total scope to ~14 days.

## Error handling & graceful degradation

| Failure | Detection | Behavior |
|---|---|---|
| **Bundled CLI missing/corrupt** | `BinaryResolver.verify()` at activation | Status bar: `ctxloom CLI missing — reinstall`. All providers inert. Output channel logs path tried. |
| **Server child crashes** | `ServerManager` listens to `process.exit` on the child | Auto-restart up to 3× over 60 s. After 3 failures: status bar `ctxloom unavailable — see Output`. Output channel shows last 50 lines of stderr. Manual `ctxloom: Restart Server` command available. |
| **MCP tool call timeout** | All tool calls wrapped in `Promise.race(..., 10s)` | Provider returns empty / cached value. One-time toast on first timeout; doesn't toast again for 5 min. |
| **Network failure during license activation** | `ApiClient` throws | Webview shows "Couldn't reach ctxloom servers. Check connection." with retry button. |
| **License expires mid-session** | Periodic re-check every 60 s while extension is active | All providers unregister cleanly. Status bar turns red. Existing diagnostics flushed. |
| **VS Code MCP API absent (older VS Code)** | Feature-detect `vscode.lm.registerMcpServerProvider` at activation | Feature 11 silently disabled. Other 10 features unaffected. Output channel logs once. |

### Two design rules enforced via tests

- **Every provider tolerates server-down.** If `ServerManager.callTool()` rejects, the provider returns the empty/cached state — never throws into VS Code's host. Crashing the host kills the extension globally.
- **No silent failures.** Every error path writes to the `ctxloom` Output channel with timestamp + tool name + cause. Users can `Output → ctxloom` for debugging. Support requests start with "send me your output channel."

## Testing strategy

Three layers, each testable independently. Uses VS Code's official `@vscode/test-electron` runner and `vitest` for pure-logic units.

### Layer 1 — Pure-logic units (vitest, fast)

`apps/vscode-extension/tests/unit/`. No VS Code API mocking — these test logic that doesn't import `vscode`.

- **`BinaryResolver.test.ts`** (~5 tests) — bundled-path resolution, `cliPath` override, missing-binary detection, hash verify, platform-correct executable extension
- **`ServerManager.test.ts`** (~8 tests) — successful spawn, crash + auto-restart up to 3× over 60 s, restart counter resets after stable 30 s, 10 s tool-call timeout, graceful close on `dispose()`, calls `client.close()` exactly once, surfaces stderr via injected logger
- **`tools.ts.test.ts`** (~6 tests) — typed wrappers correctly map MCP tool responses, error envelopes propagate, schema mismatch produces a clear error
- **`License.test.ts`** (~6 tests) — gate state machine (NO_LICENSE → TRIAL → ACTIVE → EXPIRED → re-activated), 60 s re-check timer, status-bar text per state, error mapping (Polar 503 / fingerprint / email)
- **`shared/debounce.test.ts`** (~4 tests) — leading/trailing edge, cancel on dispose

### Layer 2 — Provider integration (`@vscode/test-electron`, slower)

`apps/vscode-extension/tests/integration/`. Boots a headless VS Code with the extension loaded against `tests/fixtures/workspace-a/`. Uses a **stubbed ServerManager** so tool calls return canned responses — no real ctxloom child process, fast and deterministic.

The stub: `class FakeServerManager extends ServerManager` overriding `callTool(name, args)` with a `Map` of canned responses keyed by `(name, JSON.stringify(args))`. Per-test the suite installs the canned responses upfront.

| Provider | Tests |
|---|---|
| HoverProvider | hover over import shows risk/owner/blast count; hover outside import returns null; cache hit on second hover; renders gracefully when `ctx_risk_overlay` returns empty |
| DiagnosticsProvider | rules violation produces a Diagnostic of correct severity; clearing rules clears diagnostics; file save triggers re-check; non-source files (.png) skip the check |
| BlastRadiusView | tree shows direct/transitive/historical sections; click navigates to file; refresh on active editor change; empty-state when no blast |
| CodeHealthView | three top-level nodes (dead code / hubs / communities); manual refresh re-fetches; "Open in Dashboard" link uses `ctxloom.dashboardUrl` setting |
| GutterDecorations | high/medium/low buckets render correct ranges; dead-code marker present when 0 importers; debounce coalesces 5 rapid edits into 1 call; toggle off via `features.gutterDecorations` clears decorations |
| CodeLensProvider | lens above each top-level function; "Copy AI context" command writes skeletonized text to clipboard; toast shows reduction percentage |
| QuickFixProvider | rules violation produces a CodeAction; accepting it calls `ctx_apply_refactor` with the right args; user cancels via VS Code's confirmation → no file change |
| StatusBar | shows risk for active file; updates on editor change; trial countdown text correct; expired state turns red |
| SettingsPanel | panel mounts and renders all six sections; toggling a feature checkbox flips the matching `features.*` setting and the corresponding provider registers/unregisters within one event-loop tick; license section transitions correctly through trial-start → waiting → activated; deactivate confirmation dialog calls `deactivateLicense`; native VS Code Settings UI changes propagate back to the panel via `onDidChangeConfiguration`; panel auto-opens on first run when no license is present |
| Commands | each of the 6 palette commands invokes the right code path |

~30 integration tests total.

### Layer 3 — End-to-end smoke (`@vscode/test-electron`, real ctxloom child)

`apps/vscode-extension/tests/smoke/`. One test:

- Boots VS Code with the **real** bundled ctxloom CLI against a tiny fixture repo
- Asserts the extension activates without errors
- Asserts the ctxloom child process is alive and responds to `ctx_status`
- Asserts HoverProvider returns a non-null result on a real import
- Asserts the extension deactivates cleanly (no orphaned child process)

Catches packaging regressions — bundle path wrong, ESM resolution issue, native dep missing — that unit tests can't.

### CI integration

- Unit tests on every push (vitest, ~3 s)
- Integration + smoke run in headless `xvfb-run` Linux job and a macOS job (~90 s combined)
- VSIX build runs on PR merge to main, artifact uploaded for manual sideload testing

### Coverage target

- ≥85 % on `client/`, `license/`, `shared/`
- ≥70 % on `providers/` (where DOM/VSCode API integration limits unit-testing value)
- No specific target on `extension.ts` activation glue — covered by smoke

### Out of scope for tests

- **Live MCP bridge to Copilot Chat / Cursor** — depends on third-party extensions; manual verification documented in README's "manual test plan" section, run before each release.
- **Visual regression on hover cards / status bar** — pinning to specific render output produces flake. Snapshot the **data** going into the renderer, not the rendered HTML.
- **Polar checkout flow end-to-end** — mocked at `ApiClient` boundary; tested manually with a sandbox key before each release.

## Build, packaging & marketplace targeting

### Build pipeline

```
npm run build  (in apps/vscode-extension)
  ├─ 1. node scripts/prepare-bundle.mjs
  │     → resolves ctxloom-pro from the workspace
  │     → copies dist/ + node_modules/ into resources/ctxloom-cli/
  │     → strips dev/test files (~30 % size reduction)
  ├─ 2. tsc --noEmit (type check)
  └─ 3. esbuild src/extension.ts --platform=node --bundle --outfile=dist/extension.js
        --external:vscode  (only excluded module — VS Code provides at runtime)

npm run package  (in apps/vscode-extension)
  ├─ runs `npm run build`
  └─ runs `vsce package` → produces ctxloom-vscode-X.Y.Z.vsix
```

### VSIX expected size

- Extension code (`dist/extension.js`): ~500 KB
- Bundled `ctxloom-pro`: ~25 MB (tree-sitter grammars + LanceDB native libs)
- **Total VSIX: ~27 MB** (slight increase from the bundled webview HTML/CSS/JS for the Settings panel)

### Marketplace targets

| Registry | Reaches | Publishing |
|---|---|---|
| **VS Code Marketplace** | VS Code Stable & Insiders | `vsce publish` with a Microsoft publisher token |
| **OpenVSX** | Cursor, Windsurf, VSCodium, Gitpod, code-server | `ovsx publish` with an OpenVSX token |
| **GitHub Releases (VSIX artifact)** | Sideload-only users (early access) | Auto-published from release workflow |

Same VSIX in all three.

### Publisher identity & metadata

- Publisher: `ctxloom` on both Marketplace and OpenVSX
- Extension id: `ctxloom.ctxloom-vscode`
- Display name: `ctxloom — Code Context for Code Review`
- Categories: `Linters`, `Other`, `Programming Languages`
- Keywords: `code review`, `architecture`, `risk`, `dependency graph`, `mcp`, `ai context`, `blast radius`, `code owners`
- README at `apps/vscode-extension/README.md`, with screenshots from the dashboard for visual punch

### Versioning

- SemVer aligned with ctxloom-pro: when ctxloom-pro publishes 1.1.0, the extension publishes 1.1.0 with a fresh CLI bundle.
- Pre-release channel via Marketplace `--pre-release` flag for the 2–3 week post-launch sideload phase.

### Release process (post-launch rollout)

```
T+0   ctxloom-pro 1.x ships to npm                       (existing release workflow)
T+0   Extension VSIX built, attached to GitHub release  (new workflow this plan adds)
T+0   Internal team sideloads via VSIX
T+1w  Polish based on internal feedback, fix bugs
T+2w  Publish to Marketplace + OpenVSX as `--pre-release`
T+3w  Promote to stable on both registries
```

### CI pipeline

- **`build-extension.yml`** — runs on PR touching `apps/vscode-extension/**`. Type-check, lint, unit + integration tests, build VSIX, upload as workflow artifact.
- **`publish-extension.yml`** — runs on git tag `vscode-vX.Y.Z`. Builds, runs full test suite incl. smoke, publishes to Marketplace + OpenVSX, attaches VSIX to GitHub release.

## Future-implementations log

A companion file at `docs/future_features_vscode.md` is created at the start of implementation and updated as we go. Captures everything we deliberately punt during build:

- Multi-root workspace support (today: single-root only)
- Daemon mode (today: extension-spawns-per-workspace)
- JetBrains port (separate plugin, shares no code — pure UI surface in Kotlin)
- Branded settings panel theme variants for high-contrast / colorblind modes (today: standard color tokens)
- Settings UI for rules config (today: `ctxloom rules` CLI)
- Inline AI suggestions (out of scope — Copilot's job)
- GitLens-style blame UI (out of scope — GitLens owns it)
- Per-folder license seats / team license sharing
- Web-extension build for github.dev / vscode.dev
- Visual regression testing on hover cards / status bar
- Live integration tests against Copilot Chat / Cursor MCP

This file lives in the repo so reviewers see the deferred-work list at any time.

## Migration & backwards compatibility

- **Existing dashboard installs:** unaffected. The extension is a new surface; nothing in `apps/dashboard/` changes.
- **Existing CLI installs:** unaffected. The extension uses its own bundled CLI by default. Users with a globally-installed `ctxloom-pro` can opt in via `ctxloom.cliPath` setting if they want a single source of truth.
- **License storage:** shared at `~/.config/ctxloom/license.json` — same file CLI and dashboard use. Activating a license in any one surface activates it in all three.
- **`@ctxloom/core` exports:** no changes required for v1. The extension consumes existing public exports (license module, MCP client) plus the existing 37 MCP tools.
- **`tsup` build of ctxloom-pro:** unchanged. The extension's `prepare-bundle.mjs` consumes the existing `dist/` output.

## Success criteria

- Extension installs from VSIX with zero CLI prerequisite.
- All 11 features render correctly in the test fixture workspace.
- ≥85 % coverage on `client/`, `license/`, `shared/`; ≥70 % on `providers/`.
- Activation latency ≤ 5 s on a 1 000-file repo (one-time graph build) and ≤ 500 ms on subsequent activations (snapshot hydration).
- Hover/status-bar/code-lens responses ≤ 250 ms after debounce (cached) or ≤ 1 s (fresh).
- Smoke test passes on Linux + macOS in CI.
- Manual test plan in README covers MCP-bridge integration with Copilot Chat (or Cursor) and at least one Polar trial flow end-to-end with sandbox key.
- VSIX size ≤ 35 MB.
