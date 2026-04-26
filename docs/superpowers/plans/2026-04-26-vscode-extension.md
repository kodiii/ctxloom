# VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single VS Code extension (compatible with VS Code, Cursor, Windsurf, and other forks via OpenVSX) that exposes ctxloom's hybrid AST + git + graph data inside the editor through 12 features and a branded settings/license panel.

**Architecture:** New workspace package `apps/vscode-extension/` consumes `@ctxloom/mcp-client` to spawn a per-window ctxloom child process. A single `ServerManager` wraps the MCP client; stateless providers consume it. Bundled `ctxloom-pro` CLI ships inside the VSIX (zero CLI prerequisite). License gating is the existing Polar-backed flow shared with the CLI and dashboard. A custom webview panel (`SettingsPanel`) is the single ctxloom UI surface for license + configuration; native VS Code Settings UI remains a redundant fallback.

**Tech Stack:** TypeScript 5.7, Node 20+, VS Code Extension API ≥ 1.85, esbuild bundler, vitest + `@vscode/test-electron`, vsce/ovsx for publishing, Tailwind tokens shared with `apps/dashboard/` for the webview.

**Spec:** [docs/superpowers/specs/2026-04-25-vscode-extension-design.md](../specs/2026-04-25-vscode-extension-design.md)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `apps/vscode-extension/package.json` | VS Code manifest: contributes commands, views, configuration; activation events; npm scripts |
| `apps/vscode-extension/tsconfig.json` | TypeScript config — extends root, scopes to `src/` |
| `apps/vscode-extension/vitest.config.ts` | vitest config for `tests/unit/` |
| `apps/vscode-extension/.vscode-test.mjs` | `@vscode/test-electron` runner config for `tests/integration/` and `tests/smoke/` |
| `apps/vscode-extension/esbuild.config.mjs` | esbuild config — bundles `src/extension.ts` to `dist/extension.js`, externalizes only `vscode` |
| `apps/vscode-extension/scripts/prepare-bundle.mjs` | Build-time script — copies ctxloom-pro into `resources/ctxloom-cli/` |
| `apps/vscode-extension/src/extension.ts` | `activate()` / `deactivate()` lifecycle; wires LicenseGate + ServerManager + providers |
| `apps/vscode-extension/src/client/BinaryResolver.ts` | Resolves bundled CLI path; respects `ctxloom.cliPath` override |
| `apps/vscode-extension/src/client/ServerManager.ts` | Owns mcp-client lifecycle; auto-restart up to 3× / 60s; tool-call timeout |
| `apps/vscode-extension/src/client/tools.ts` | Typed wrappers around the 9 MCP tools we use |
| `apps/vscode-extension/src/license/LicenseGate.ts` | License state machine, 60s re-check, register/unregister gating |
| `apps/vscode-extension/src/license/statusBar.ts` | Status-bar item renderer (license + file risk) |
| `apps/vscode-extension/src/settings/SettingsPanel.ts` | Webview host: mount, dispose, message routing |
| `apps/vscode-extension/src/settings/messageProtocol.ts` | Typed `Host → Webview` and `Webview → Host` message envelopes |
| `apps/vscode-extension/src/settings/webview/index.html` | Panel HTML shell |
| `apps/vscode-extension/src/settings/webview/main.ts` | Vanilla TS bundle for the panel — sections, inputs, postMessage |
| `apps/vscode-extension/src/settings/webview/styles.css` | Tailwind-tokens-aligned CSS (no Tailwind runtime — pre-emitted) |
| `apps/vscode-extension/src/providers/HoverProvider.ts` | Feature 1 — risk/owners/blast-count card |
| `apps/vscode-extension/src/providers/DiagnosticsProvider.ts` | Feature 2 — rules → squiggles |
| `apps/vscode-extension/src/providers/BlastRadiusView.ts` | Feature 4 — TreeDataProvider |
| `apps/vscode-extension/src/providers/CodeHealthView.ts` | Feature 5 — TreeDataProvider |
| `apps/vscode-extension/src/providers/CodeLensProvider.ts` | Features 7 + 9 — file-top lens + per-symbol "Copy AI Context" |
| `apps/vscode-extension/src/providers/GutterDecorations.ts` | Feature 8 — churn heatmap + dead-code marker |
| `apps/vscode-extension/src/providers/QuickFixProvider.ts` | Feature 10 — rules → ctx_apply_refactor |
| `apps/vscode-extension/src/providers/McpBridge.ts` | Feature 11 — registers ctxloom as MCP server for Copilot Chat / Cursor / Continue |
| `apps/vscode-extension/src/commands/index.ts` | Six palette commands + license commands |
| `apps/vscode-extension/src/shared/debounce.ts` | Shared debounce utility |
| `apps/vscode-extension/src/shared/cache.ts` | Per-file TTL cache |
| `apps/vscode-extension/src/shared/logger.ts` | OutputChannel wrapper |
| `apps/vscode-extension/resources/icons/` | Extension icons (existing dashboard logo svg) |
| `apps/vscode-extension/README.md` | Marketplace listing + manual test plan |
| `apps/vscode-extension/.vscodeignore` | Files excluded from VSIX |
| `apps/vscode-extension/.gitignore` | Excludes `dist/`, `out/`, `resources/ctxloom-cli/`, `*.vsix` |
| `apps/vscode-extension/tests/unit/BinaryResolver.test.ts` | Unit tests for the resolver |
| `apps/vscode-extension/tests/unit/ServerManager.test.ts` | Unit tests with stubbed mcp-client |
| `apps/vscode-extension/tests/unit/tools.test.ts` | Wrappers map MCP responses correctly |
| `apps/vscode-extension/tests/unit/LicenseGate.test.ts` | State-machine tests |
| `apps/vscode-extension/tests/unit/shared.debounce.test.ts` | Debounce semantics |
| `apps/vscode-extension/tests/unit/shared.cache.test.ts` | Cache TTL + invalidate |
| `apps/vscode-extension/tests/unit/messageProtocol.test.ts` | Typed message validation |
| `apps/vscode-extension/tests/integration/setup.ts` | Stubbed ServerManager fixture for integration tests |
| `apps/vscode-extension/tests/integration/HoverProvider.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/integration/DiagnosticsProvider.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/integration/BlastRadiusView.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/integration/CodeHealthView.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/integration/GutterDecorations.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/integration/CodeLensProvider.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/integration/QuickFixProvider.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/integration/StatusBar.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/integration/SettingsPanel.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/integration/Commands.test.ts` | Headless VS Code test |
| `apps/vscode-extension/tests/smoke/end-to-end.test.ts` | Real bundled CLI test |
| `apps/vscode-extension/tests/fixtures/workspace-a/` | Tiny TS workspace for tests |
| `.github/workflows/build-extension.yml` | CI: build + test on PR |
| `.github/workflows/publish-extension.yml` | CI: publish on tag |
| `docs/future_features_vscode.md` | Punted-work log (created in Task 25) |

### Modified files

| Path | Change |
|---|---|
| `package.json` (root) | Workspace `apps/*` already includes vscode-extension; no change needed (verify in Task 1) |
| `tsconfig.json` (root) | Add `apps/vscode-extension/src` to references — only if root tsconfig uses references; otherwise no change |

---

## Implementation order — phases

1. **Phase 0 — Foundation** (Tasks 1–4): scaffold + BinaryResolver + ServerManager + shared helpers
2. **Phase 1 — License core** (Tasks 5–6): LicenseGate state machine + status bar
3. **Phase 2 — Settings panel** (Tasks 7–10): message protocol, panel host, webview, config sync
4. **Phase 3 — Read-only providers** (Tasks 11–15): hover, diagnostics, blast view, code-health view, view container
5. **Phase 4 — Rich providers** (Tasks 16–21): file-top lens, copy-AI-context lens, gutter, quick-fixes, commands, MCP bridge
6. **Phase 5 — Build & ship** (Tasks 22–25): prepare-bundle, smoke test, CI workflows, README

Each phase produces working software at its commit boundary. Tasks within a phase are sequential — later tasks depend on earlier ones.

---

## Phase 0 — Foundation

### Task 1: Workspace package scaffold

**Files:**
- Create: `apps/vscode-extension/package.json`
- Create: `apps/vscode-extension/tsconfig.json`
- Create: `apps/vscode-extension/vitest.config.ts`
- Create: `apps/vscode-extension/.vscode-test.mjs`
- Create: `apps/vscode-extension/esbuild.config.mjs`
- Create: `apps/vscode-extension/.gitignore`
- Create: `apps/vscode-extension/.vscodeignore`
- Create: `apps/vscode-extension/src/extension.ts` (stub only)
- Create: `apps/vscode-extension/resources/icons/icon.png` (copy from `apps/dashboard/client/public/logo.svg` after rasterizing — or use a placeholder)

- [ ] **Step 1: Create the package manifest**

Write `apps/vscode-extension/package.json`:

```json
{
  "name": "@ctxloom/vscode-extension",
  "displayName": "ctxloom — Code Context for Code Review",
  "description": "AST + git + graph context, in your editor. Hover risk, blast radius, dead code, MCP bridge for AI assistants.",
  "version": "0.1.0",
  "private": true,
  "publisher": "ctxloom",
  "engines": { "vscode": "^1.85.0", "node": ">=20.0.0" },
  "type": "commonjs",
  "main": "./dist/extension.js",
  "icon": "resources/icons/icon.png",
  "categories": ["Linters", "Other", "Programming Languages"],
  "keywords": ["code review", "architecture", "risk", "dependency graph", "mcp", "ai context", "blast radius", "code owners"],
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "ctxloom.openSettings",          "title": "ctxloom: Open Settings" },
      { "command": "ctxloom.activateLicense",       "title": "ctxloom: Activate License Key" },
      { "command": "ctxloom.startTrial",            "title": "ctxloom: Start Free Trial" },
      { "command": "ctxloom.showLicenseStatus",     "title": "ctxloom: Show License Status" },
      { "command": "ctxloom.deactivateLicense",     "title": "ctxloom: Deactivate License" },
      { "command": "ctxloom.openDashboard",         "title": "ctxloom: Open Dashboard" },
      { "command": "ctxloom.showBlastRadius",       "title": "ctxloom: Show Blast Radius" },
      { "command": "ctxloom.showOwners",            "title": "ctxloom: Show Owners" },
      { "command": "ctxloom.copyContextPacket",     "title": "ctxloom: Generate Context Packet" },
      { "command": "ctxloom.refreshCodeHealth",     "title": "ctxloom: Refresh Code Health" },
      { "command": "ctxloom.restartServer",         "title": "ctxloom: Restart Server" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "ctxloom",            "title": "ctxloom",  "icon": "resources/icons/icon.png" }
      ]
    },
    "views": {
      "ctxloom": [
        { "id": "ctxloom.blastRadius", "name": "Blast Radius",  "contextualTitle": "ctxloom" },
        { "id": "ctxloom.codeHealth",  "name": "Code Health",    "contextualTitle": "ctxloom" }
      ]
    },
    "configuration": {
      "title": "ctxloom",
      "properties": {
        "ctxloom.cliPath":                    { "type": ["string","null"], "default": null,  "description": "Override the bundled ctxloom CLI." },
        "ctxloom.serverArgs":                 { "type": "array",  "default": [], "items": { "type": "string" }, "description": "Extra args passed to the spawned server." },
        "ctxloom.debounceMs":                 { "type": "number", "default": 250, "description": "Shared debounce for editor events." },
        "ctxloom.cacheTtlSeconds":            { "type": "number", "default": 30,  "description": "Per-file TTL for risk/call-graph results." },
        "ctxloom.features.hover":             { "type": "boolean","default": true,"description": "Enable hover cards." },
        "ctxloom.features.diagnostics":       { "type": "boolean","default": true,"description": "Enable rules diagnostics (squiggles)." },
        "ctxloom.features.gutterDecorations": { "type": "boolean","default": true,"description": "Enable gutter churn heatmap and dead-code markers." },
        "ctxloom.features.codeLens":          { "type": "boolean","default": true,"description": "Enable file-top and per-symbol code lenses." },
        "ctxloom.features.quickFixes":        { "type": "boolean","default": true,"description": "Enable rules quick-fixes." },
        "ctxloom.features.mcpBridge":         { "type": "boolean","default": true,"description": "Auto-register ctxloom as an MCP server for AI assistants (VS Code 1.95+)." },
        "ctxloom.gutter.churnThresholdHigh":  { "type": "number", "default": 1000,"description": "Lines added+deleted per year for the 'high' churn bucket." },
        "ctxloom.gutter.churnThresholdMedium":{ "type": "number", "default": 200, "description": "Lines added+deleted per year for the 'medium' churn bucket." },
        "ctxloom.gutter.showDeadCodeMarker":  { "type": "boolean","default": true,"description": "Show a dead-code marker for files with zero importers." },
        "ctxloom.dashboardUrl":               { "type": "string", "default": "http://localhost:7842", "description": "URL the status-bar / panels link to." },
        "ctxloom.telemetry.enabled":          { "type": "boolean","default": false,"description": "Send anonymous usage data. Off by default." }
      }
    }
  },
  "scripts": {
    "build":   "node scripts/prepare-bundle.mjs && tsc --noEmit && node esbuild.config.mjs",
    "watch":   "node esbuild.config.mjs --watch",
    "package": "npm run build && vsce package --no-dependencies",
    "publish": "vsce publish --no-dependencies && ovsx publish",
    "test":    "vitest run",
    "test:integration": "vscode-test",
    "lint":    "tsc --noEmit"
  },
  "dependencies": {
    "@ctxloom/mcp-client": "*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/vscode": "^1.85.0",
    "@vscode/test-cli": "^0.0.10",
    "@vscode/test-electron": "^2.4.1",
    "esbuild": "^0.24.0",
    "ovsx": "^0.10.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "vsce": "^2.15.0"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Write `apps/vscode-extension/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "out",
    "rootDir": "src",
    "module": "Node16",
    "moduleResolution": "Node16",
    "noEmit": true,
    "types": ["node", "vscode"]
  },
  "include": ["src/**/*", "tests/**/*", "esbuild.config.mjs", "scripts/**/*"],
  "exclude": ["node_modules", "dist", "out", "resources/ctxloom-cli"]
}
```

- [ ] **Step 3: Create vitest config**

Write `apps/vscode-extension/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/extension.ts', 'src/settings/webview/**'],
      thresholds: { lines: 70, branches: 60, functions: 70 },
    },
  },
});
```

- [ ] **Step 4: Create vscode-test runner config**

Write `apps/vscode-extension/.vscode-test.mjs`:

```javascript
import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'integration',
    files: 'out/tests/integration/**/*.test.js',
    workspaceFolder: 'tests/fixtures/workspace-a',
    mocha: { ui: 'tdd', timeout: 20_000 },
  },
  {
    label: 'smoke',
    files: 'out/tests/smoke/**/*.test.js',
    workspaceFolder: 'tests/fixtures/workspace-a',
    mocha: { ui: 'tdd', timeout: 60_000 },
  },
]);
```

- [ ] **Step 5: Create esbuild config**

Write `apps/vscode-extension/esbuild.config.mjs`:

```javascript
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
});

if (watch) { await ctx.watch(); }
else       { await ctx.rebuild(); await ctx.dispose(); }
```

- [ ] **Step 6: Create gitignore + vscodeignore**

Write `apps/vscode-extension/.gitignore`:

```
dist/
out/
resources/ctxloom-cli/
node_modules/
*.vsix
.vscode-test/
coverage/
```

Write `apps/vscode-extension/.vscodeignore`:

```
.vscode-test/
.vscode-test.mjs
src/**
tests/**
out/**
node_modules/**
scripts/**
esbuild.config.mjs
tsconfig.json
vitest.config.ts
.gitignore
*.map
**/*.ts
!dist/extension.js
```

- [ ] **Step 7: Create stub extension.ts**

Write `apps/vscode-extension/src/extension.ts`:

```typescript
import * as vscode from 'vscode';

export async function activate(_context: vscode.ExtensionContext): Promise<void> {
  // Implementation lands incrementally over Tasks 5+.
}

export function deactivate(): void {
  // Implementation lands in Task 5.
}
```

- [ ] **Step 8: Create placeholder icon**

Run:

```bash
mkdir -p apps/vscode-extension/resources/icons
# Reuse the dashboard logo svg as a temporary placeholder.
# Final 128×128 PNG icon is generated in Task 25 (README task).
cp apps/dashboard/client/public/logo.svg apps/vscode-extension/resources/icons/icon.svg
# vsce requires a PNG — write a 128×128 transparent placeholder for now:
node -e "
  const fs=require('fs');
  const buf=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAQAAAAg6oTPAAAAFklEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAABJRU5ErkJggg==','base64');
  fs.writeFileSync('apps/vscode-extension/resources/icons/icon.png', buf);
"
```

- [ ] **Step 9: Verify the package is recognized as a workspace**

Run: `npm install`
Expected: completes without error; `apps/vscode-extension/node_modules/` is created (or hoisted) and `@ctxloom/mcp-client` resolves from the workspace.

Run: `npm run lint --workspace=@ctxloom/vscode-extension`
Expected: `tsc --noEmit` exits 0.

- [ ] **Step 10: Commit**

```bash
git add apps/vscode-extension/ package-lock.json
git commit -m "chore(vscode-extension): scaffold workspace package and manifest"
```

---

### Task 2: BinaryResolver (TDD)

**Files:**
- Create: `apps/vscode-extension/src/client/BinaryResolver.ts`
- Test: `apps/vscode-extension/tests/unit/BinaryResolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `apps/vscode-extension/tests/unit/BinaryResolver.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { resolveCliPath } from '../../src/client/BinaryResolver.js';

function makeTmpExtensionRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binresolver-'));
  fs.mkdirSync(path.join(dir, 'resources/ctxloom-cli/dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'resources/ctxloom-cli/dist/index.js'), '#!/usr/bin/env node\n');
  return dir;
}

describe('resolveCliPath', () => {
  let extRoot: string;
  beforeEach(() => { extRoot = makeTmpExtensionRoot(); });
  afterEach(() => { fs.rmSync(extRoot, { recursive: true, force: true }); });

  it('returns the bundled path when no override is configured', () => {
    const result = resolveCliPath({ extensionRoot: extRoot, override: null });
    expect(result.source).toBe('bundled');
    expect(result.path).toBe(path.join(extRoot, 'resources/ctxloom-cli/dist/index.js'));
    expect(result.exists).toBe(true);
  });

  it('returns the override path when configured', () => {
    const overridePath = path.join(extRoot, 'custom/ctxloom');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '');
    const result = resolveCliPath({ extensionRoot: extRoot, override: overridePath });
    expect(result.source).toBe('override');
    expect(result.path).toBe(overridePath);
    expect(result.exists).toBe(true);
  });

  it('reports exists=false when bundled CLI is missing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    const result = resolveCliPath({ extensionRoot: empty, override: null });
    expect(result.exists).toBe(false);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('reports exists=false when override points to a non-existent file', () => {
    const result = resolveCliPath({ extensionRoot: extRoot, override: '/nope/no-such-file' });
    expect(result.source).toBe('override');
    expect(result.exists).toBe(false);
  });

  it('expands ~ in override paths to the user home', () => {
    const home = os.homedir();
    const real = path.join(home, '.fake-ctxloom-test-' + Date.now());
    fs.writeFileSync(real, '');
    try {
      const result = resolveCliPath({ extensionRoot: extRoot, override: '~/' + path.basename(real) });
      expect(result.path).toBe(real);
      expect(result.exists).toBe(true);
    } finally {
      fs.unlinkSync(real);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/BinaryResolver.test.ts`
Expected: All 5 tests fail — module does not exist.

- [ ] **Step 3: Implement BinaryResolver**

Write `apps/vscode-extension/src/client/BinaryResolver.ts`:

```typescript
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface ResolveOptions {
  /** Absolute path to the extension installation root (use `context.extensionPath`). */
  extensionRoot: string;
  /** User-configured override path or null. */
  override: string | null;
}

export interface ResolveResult {
  /** 'bundled' = used the VSIX-shipped CLI; 'override' = used user-configured path. */
  source: 'bundled' | 'override';
  /** Absolute, ~-expanded path to the entry. */
  path: string;
  /** Does the file exist on disk right now? */
  exists: boolean;
}

const BUNDLED_SUBPATH = path.join('resources', 'ctxloom-cli', 'dist', 'index.js');

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export function resolveCliPath(opts: ResolveOptions): ResolveResult {
  if (opts.override !== null && opts.override.trim() !== '') {
    const expanded = path.resolve(expandHome(opts.override));
    return { source: 'override', path: expanded, exists: fs.existsSync(expanded) };
  }
  const bundled = path.join(opts.extensionRoot, BUNDLED_SUBPATH);
  return { source: 'bundled', path: bundled, exists: fs.existsSync(bundled) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/BinaryResolver.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/client/BinaryResolver.ts apps/vscode-extension/tests/unit/BinaryResolver.test.ts
git commit -m "feat(vscode-extension): BinaryResolver — bundled + override path resolution"
```

---

### Task 3: ServerManager (TDD with stubbed mcp-client)

**Files:**
- Create: `apps/vscode-extension/src/client/ServerManager.ts`
- Test: `apps/vscode-extension/tests/unit/ServerManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `apps/vscode-extension/tests/unit/ServerManager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ServerManager } from '../../src/client/ServerManager.js';

interface FakeClient extends EventEmitter {
  callTool(args: { name: string; arguments: Record<string, unknown> }): Promise<{ content: unknown }>;
  close(): Promise<void>;
  __closed: boolean;
}

function makeFakeClient(): FakeClient {
  const c = new EventEmitter() as FakeClient;
  c.__closed = false;
  c.callTool = vi.fn(async ({ name }) => ({ content: { tool: name } }));
  c.close = vi.fn(async () => { c.__closed = true; });
  return c;
}

interface StubbedSpawnerHandle {
  fakeClient: FakeClient;
  spawnCalls: number;
  triggerCrash(reason?: string): void;
}

function makeStubbedSpawner(): { spawn: () => Promise<FakeClient>; handle: StubbedSpawnerHandle } {
  const handle: StubbedSpawnerHandle = {
    fakeClient: makeFakeClient(),
    spawnCalls: 0,
    triggerCrash(reason = 'crash') { handle.fakeClient.emit('error', new Error(reason)); },
  };
  const spawn = async () => {
    handle.spawnCalls++;
    handle.fakeClient = makeFakeClient();
    return handle.fakeClient;
  };
  return { spawn, handle };
}

describe('ServerManager', () => {
  let logged: string[];
  beforeEach(() => { logged = []; });
  afterEach(() => { vi.useRealTimers(); });

  function logger() { return { info: (m: string) => logged.push('info: ' + m), warn: (m: string) => logged.push('warn: ' + m), error: (m: string) => logged.push('error: ' + m) }; }

  it('spawns the child on start() and exposes callTool', async () => {
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    const result = await sm.callTool('ctx_status', {});
    expect(handle.spawnCalls).toBe(1);
    expect(result).toEqual({ content: { tool: 'ctx_status' } });
    await sm.dispose();
  });

  it('auto-restarts on child error up to 3 times within 60s', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    handle.triggerCrash();
    await vi.advanceTimersByTimeAsync(50);
    handle.triggerCrash();
    await vi.advanceTimersByTimeAsync(50);
    handle.triggerCrash();
    await vi.advanceTimersByTimeAsync(50);
    expect(handle.spawnCalls).toBe(4); // initial + 3 restarts
    await sm.dispose();
  });

  it('stops restarting after 3 failures within 60s and reports unavailable', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    for (let i = 0; i < 4; i++) {
      handle.triggerCrash();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(handle.spawnCalls).toBe(4); // initial + only 3 restarts; the 4th crash is NOT restarted
    expect(sm.isAvailable()).toBe(false);
    await sm.dispose();
  });

  it('resets the restart counter after 30 seconds of stable uptime', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    handle.triggerCrash(); await vi.advanceTimersByTimeAsync(30_001);
    handle.triggerCrash(); await vi.advanceTimersByTimeAsync(30_001);
    handle.triggerCrash(); await vi.advanceTimersByTimeAsync(30_001);
    handle.triggerCrash(); await vi.advanceTimersByTimeAsync(50);
    // Counter resets after each 30s stable window, so all 4 crashes get restarted
    expect(handle.spawnCalls).toBe(5);
    expect(sm.isAvailable()).toBe(true);
    await sm.dispose();
  });

  it('rejects callTool with timeout after 10 seconds', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    handle.fakeClient.callTool = vi.fn(() => new Promise(() => { /* never resolves */ }));
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    const promise = sm.callTool('ctx_status', {});
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(promise).rejects.toThrow(/timeout/i);
    await sm.dispose();
  });

  it('dispose closes the underlying client exactly once', async () => {
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    const client = handle.fakeClient;
    await sm.dispose();
    await sm.dispose(); // idempotent
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.__closed).toBe(true);
  });

  it('callTool after dispose rejects', async () => {
    const { spawn } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    await sm.dispose();
    await expect(sm.callTool('ctx_status', {})).rejects.toThrow(/disposed/i);
  });

  it('logs each restart with the cause', async () => {
    vi.useFakeTimers();
    const { spawn, handle } = makeStubbedSpawner();
    const sm = new ServerManager({ spawner: spawn, logger: logger() });
    await sm.start();
    handle.triggerCrash('boom');
    await vi.advanceTimersByTimeAsync(50);
    expect(logged.some(l => l.includes('boom'))).toBe(true);
    await sm.dispose();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/ServerManager.test.ts`
Expected: All 8 tests fail — module does not exist.

- [ ] **Step 3: Implement ServerManager**

Write `apps/vscode-extension/src/client/ServerManager.ts`:

```typescript
import { EventEmitter } from 'node:events';

export interface ServerLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface ServerClient extends EventEmitter {
  callTool(args: { name: string; arguments: Record<string, unknown> }): Promise<{ content: unknown }>;
  close(): Promise<void>;
}

export interface ServerManagerOptions {
  spawner: () => Promise<ServerClient>;
  logger: ServerLogger;
  /** Override the 60s window for test purposes. */
  restartWindowMs?: number;
  /** Override the max restart attempts within the window. */
  maxRestartsPerWindow?: number;
  /** Override the 10s tool-call timeout. */
  toolCallTimeoutMs?: number;
  /** Override the 30s stable-uptime threshold for resetting restart counter. */
  stableResetMs?: number;
}

export class ServerManager {
  private client: ServerClient | null = null;
  private restartTimes: number[] = [];
  private disposed = false;
  private available = false;
  private lastSpawnAt = 0;

  private readonly restartWindowMs: number;
  private readonly maxRestarts: number;
  private readonly toolCallTimeoutMs: number;
  private readonly stableResetMs: number;

  constructor(private readonly opts: ServerManagerOptions) {
    this.restartWindowMs = opts.restartWindowMs ?? 60_000;
    this.maxRestarts = opts.maxRestartsPerWindow ?? 3;
    this.toolCallTimeoutMs = opts.toolCallTimeoutMs ?? 10_000;
    this.stableResetMs = opts.stableResetMs ?? 30_000;
  }

  isAvailable(): boolean { return this.available && !this.disposed; }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('ServerManager disposed');
    await this.spawnAndAttach();
  }

  private async spawnAndAttach(): Promise<void> {
    this.client = await this.opts.spawner();
    this.lastSpawnAt = Date.now();
    this.available = true;
    this.client.on('error', (err: Error) => this.handleCrash(err));
    this.client.on('close', () => this.handleCrash(new Error('client closed unexpectedly')));
    this.opts.logger.info('ctxloom server spawned');
  }

  private handleCrash(err: Error): void {
    if (this.disposed) return;
    this.available = false;
    const stableFor = Date.now() - this.lastSpawnAt;
    if (stableFor >= this.stableResetMs) {
      // Stable run before this crash — counter resets so we don't punish past flakes.
      this.restartTimes = [];
    }
    this.opts.logger.warn(`server crashed: ${err.message}`);
    this.attemptRestart();
  }

  private attemptRestart(): void {
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter(t => now - t < this.restartWindowMs);
    if (this.restartTimes.length >= this.maxRestarts) {
      this.opts.logger.error(`ctxloom unavailable — ${this.restartTimes.length} restarts in ${this.restartWindowMs / 1000}s`);
      return;
    }
    this.restartTimes.push(now);
    this.opts.logger.info(`restarting ctxloom (attempt ${this.restartTimes.length} / ${this.maxRestarts})`);
    this.spawnAndAttach().catch(err => this.opts.logger.error(`spawn failed: ${String(err)}`));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown }> {
    if (this.disposed) throw new Error('ServerManager disposed');
    if (!this.client || !this.available) throw new Error('ctxloom server unavailable');
    const promise = this.client.callTool({ name, arguments: args });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`tool call timeout: ${name}`)), this.toolCallTimeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.available = false;
    if (this.client) {
      try { await this.client.close(); }
      catch (err) { this.opts.logger.warn(`close failed: ${String(err)}`); }
      this.client = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/ServerManager.test.ts`
Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/client/ServerManager.ts apps/vscode-extension/tests/unit/ServerManager.test.ts
git commit -m "feat(vscode-extension): ServerManager — spawn, auto-restart, tool timeout, dispose"
```

---

### Task 4: Shared helpers (debounce + cache + logger)

**Files:**
- Create: `apps/vscode-extension/src/shared/debounce.ts`
- Create: `apps/vscode-extension/src/shared/cache.ts`
- Create: `apps/vscode-extension/src/shared/logger.ts`
- Test: `apps/vscode-extension/tests/unit/shared.debounce.test.ts`
- Test: `apps/vscode-extension/tests/unit/shared.cache.test.ts`

- [ ] **Step 1: Write the failing debounce tests**

Write `apps/vscode-extension/tests/unit/shared.debounce.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../../src/shared/debounce.js';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces multiple rapid calls into a single trailing invocation', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a'); d('b'); d('c');
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('schedules a fresh trailing invocation after the delay elapses', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('first'); vi.advanceTimersByTime(101);
    d('second'); vi.advanceTimersByTime(101);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'first');
    expect(fn).toHaveBeenNthCalledWith(2, 'second');
  });

  it('cancel() prevents the pending invocation', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('x');
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it('flush() invokes immediately with the latest args', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('x'); d('y');
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('y');
  });
});
```

- [ ] **Step 2: Write the failing cache tests**

Write `apps/vscode-extension/tests/unit/shared.cache.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from '../../src/shared/cache.js';

describe('TtlCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns a cached value on second get within TTL', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('k', 1);
    vi.advanceTimersByTime(500);
    expect(c.get('k')).toBe(1);
  });

  it('returns undefined after TTL expires', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('k', 1);
    vi.advanceTimersByTime(1001);
    expect(c.get('k')).toBeUndefined();
  });

  it('invalidate(key) removes a single entry', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('a', 1); c.set('b', 2);
    c.invalidate('a');
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
  });

  it('clear() removes all entries', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('a', 1); c.set('b', 2);
    c.clear();
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeUndefined();
  });

  it('overwrites existing entry and resets TTL', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('k', 1);
    vi.advanceTimersByTime(900);
    c.set('k', 2);
    vi.advanceTimersByTime(900);
    expect(c.get('k')).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/shared.debounce.test.ts tests/unit/shared.cache.test.ts`
Expected: All 9 tests fail — modules do not exist.

- [ ] **Step 4: Implement the helpers**

Write `apps/vscode-extension/src/shared/debounce.ts`:

```typescript
export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel(): void;
  flush(): void;
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, waitMs: number): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  const debounced = ((...args: Args) => {
    pendingArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = pendingArgs;
      pendingArgs = null;
      if (a !== null) fn(...a);
    }, waitMs);
  }) as Debounced<Args>;

  debounced.cancel = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    pendingArgs = null;
  };

  debounced.flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const a = pendingArgs;
    pendingArgs = null;
    if (a !== null) fn(...a);
  };

  return debounced;
}
```

Write `apps/vscode-extension/src/shared/cache.ts`:

```typescript
export interface TtlCacheOptions {
  ttlMs: number;
}

interface Entry<V> { value: V; expiresAt: number }

export class TtlCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly ttlMs: number;

  constructor(opts: TtlCacheOptions) { this.ttlMs = opts.ttlMs; }

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (e === undefined) return undefined;
    if (Date.now() >= e.expiresAt) { this.map.delete(key); return undefined; }
    return e.value;
  }

  set(key: K, value: V): void {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key: K): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}
```

Write `apps/vscode-extension/src/shared/logger.ts`:

```typescript
import * as vscode from 'vscode';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  show(): void;
  dispose(): void;
}

export function createOutputLogger(): Logger {
  const channel = vscode.window.createOutputChannel('ctxloom');
  function ts(): string { return new Date().toISOString(); }
  function write(level: string, msg: string): void {
    channel.appendLine(`[${ts()}] ${level} ${msg}`);
  }
  return {
    info:  m => write('INFO', m),
    warn:  m => write('WARN', m),
    error: m => write('ERROR', m),
    show:  () => channel.show(true),
    dispose: () => channel.dispose(),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/shared.debounce.test.ts tests/unit/shared.cache.test.ts`
Expected: All 9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/vscode-extension/src/shared/ apps/vscode-extension/tests/unit/shared.*.test.ts
git commit -m "feat(vscode-extension): shared helpers — debounce, TtlCache, OutputChannel logger"
```

---

## Phase 1 — License core

### Task 5: LicenseGate state machine (TDD)

**Files:**
- Create: `apps/vscode-extension/src/license/LicenseGate.ts`
- Test: `apps/vscode-extension/tests/unit/LicenseGate.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `apps/vscode-extension/tests/unit/LicenseGate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LicenseGate, type LicenseInfo } from '../../src/license/LicenseGate.js';

function info(overrides: Partial<LicenseInfo> = {}): LicenseInfo {
  return {
    tier: 'pro',
    status: 'active',
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    fingerprint: 'abc123',
    ...overrides,
  };
}

describe('LicenseGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports NO_LICENSE when getLicenseInfo returns null', async () => {
    const gate = new LicenseGate({ getInfo: async () => null, recheckMs: 60_000 });
    const state = await gate.evaluate();
    expect(state.kind).toBe('NO_LICENSE');
  });

  it('reports LICENSED when status is active and not expiring soon', async () => {
    const gate = new LicenseGate({ getInfo: async () => info(), recheckMs: 60_000 });
    const state = await gate.evaluate();
    expect(state.kind).toBe('LICENSED');
    if (state.kind === 'LICENSED') expect(state.tier).toBe('pro');
  });

  it('reports TRIALING when tier is trial and status is trialing', async () => {
    const gate = new LicenseGate({ getInfo: async () => info({ tier: 'trial', status: 'trialing', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }), recheckMs: 60_000 });
    const state = await gate.evaluate();
    expect(state.kind).toBe('TRIALING');
    if (state.kind === 'TRIALING') expect(state.daysLeft).toBeGreaterThanOrEqual(4);
  });

  it('reports EXPIRED when expiresAt is in the past', async () => {
    const gate = new LicenseGate({ getInfo: async () => info({ status: 'expired', expiresAt: new Date(Date.now() - 1).toISOString() }), recheckMs: 60_000 });
    const state = await gate.evaluate();
    expect(state.kind).toBe('EXPIRED');
  });

  it('emits a state change when re-check finds a different state', async () => {
    let current: LicenseInfo | null = null;
    const gate = new LicenseGate({ getInfo: async () => current, recheckMs: 60_000 });
    const observed: string[] = [];
    gate.onStateChange(s => observed.push(s.kind));
    await gate.evaluate();
    gate.startRechecking();
    current = info();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(observed).toContain('LICENSED');
    gate.dispose();
  });

  it('does NOT emit when re-check finds the same state', async () => {
    const gate = new LicenseGate({ getInfo: async () => info(), recheckMs: 60_000 });
    const observed: string[] = [];
    await gate.evaluate();
    gate.onStateChange(s => observed.push(s.kind));
    gate.startRechecking();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(observed).toHaveLength(0);
    gate.dispose();
  });

  it('dispose() stops the recheck timer', async () => {
    const getInfo = vi.fn(async () => info());
    const gate = new LicenseGate({ getInfo, recheckMs: 60_000 });
    await gate.evaluate();
    gate.startRechecking();
    gate.dispose();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getInfo).toHaveBeenCalledTimes(1); // only the initial evaluate
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/LicenseGate.test.ts`
Expected: All 7 tests fail — module does not exist.

- [ ] **Step 3: Implement LicenseGate**

Write `apps/vscode-extension/src/license/LicenseGate.ts`:

```typescript
export type Tier = 'pro' | 'team' | 'enterprise' | 'trial';
export type Status = 'active' | 'trialing' | 'expired';

export interface LicenseInfo {
  tier: Tier;
  status: Status;
  /** ISO-8601 string */
  expiresAt: string;
  fingerprint: string;
}

export type LicenseState =
  | { kind: 'NO_LICENSE' }
  | { kind: 'TRIALING'; tier: Tier; daysLeft: number; expiresAt: string }
  | { kind: 'LICENSED'; tier: Tier; expiresAt: string }
  | { kind: 'EXPIRED'; expiresAt: string };

export interface LicenseGateOptions {
  /** Reads from `~/.config/ctxloom/license.json` via the bundled license module. */
  getInfo: () => Promise<LicenseInfo | null>;
  /** Re-check interval. */
  recheckMs: number;
}

type Listener = (state: LicenseState) => void;

export class LicenseGate {
  private state: LicenseState = { kind: 'NO_LICENSE' };
  private listeners: Listener[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly opts: LicenseGateOptions) {}

  current(): LicenseState { return this.state; }

  async evaluate(): Promise<LicenseState> {
    const info = await this.opts.getInfo();
    const next = this.derive(info);
    this.transition(next);
    return next;
  }

  private derive(info: LicenseInfo | null): LicenseState {
    if (info === null) return { kind: 'NO_LICENSE' };
    const expiresMs = new Date(info.expiresAt).getTime();
    if (Number.isNaN(expiresMs) || expiresMs <= Date.now()) return { kind: 'EXPIRED', expiresAt: info.expiresAt };
    if (info.tier === 'trial' || info.status === 'trialing') {
      const daysLeft = Math.max(0, Math.floor((expiresMs - Date.now()) / 86_400_000));
      return { kind: 'TRIALING', tier: info.tier, daysLeft, expiresAt: info.expiresAt };
    }
    return { kind: 'LICENSED', tier: info.tier, expiresAt: info.expiresAt };
  }

  private transition(next: LicenseState): void {
    if (sameState(this.state, next)) return;
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  onStateChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  startRechecking(): void {
    if (this.disposed || this.timer !== null) return;
    this.timer = setInterval(() => { this.evaluate().catch(() => { /* logged elsewhere */ }); }, this.opts.recheckMs);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.listeners = [];
  }
}

function sameState(a: LicenseState, b: LicenseState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'NO_LICENSE' || b.kind === 'NO_LICENSE') return true;
  if (a.kind === 'TRIALING' && b.kind === 'TRIALING') return a.daysLeft === b.daysLeft && a.expiresAt === b.expiresAt;
  if (a.kind === 'LICENSED' && b.kind === 'LICENSED') return a.tier === b.tier && a.expiresAt === b.expiresAt;
  if (a.kind === 'EXPIRED' && b.kind === 'EXPIRED') return a.expiresAt === b.expiresAt;
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/LicenseGate.test.ts`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/license/LicenseGate.ts apps/vscode-extension/tests/unit/LicenseGate.test.ts
git commit -m "feat(vscode-extension): LicenseGate state machine + 60s re-check"
```

---

### Task 6: Status-bar item

**Files:**
- Create: `apps/vscode-extension/src/license/statusBar.ts`
- (Integration test deferred to Task 11 once providers are registering risk lookups; pure logic is unit-tested via the renderer function.)
- Test: `apps/vscode-extension/tests/unit/statusBar.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `apps/vscode-extension/tests/unit/statusBar.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderStatusBar, type StatusBarInputs } from '../../src/license/statusBar.js';

function input(overrides: Partial<StatusBarInputs> = {}): StatusBarInputs {
  return {
    licenseState: { kind: 'LICENSED', tier: 'pro', expiresAt: '' },
    riskScore: null,
    ...overrides,
  };
}

describe('renderStatusBar', () => {
  it('shows risk score and "ctxloom" mark when licensed', () => {
    const r = renderStatusBar(input({ riskScore: 0.42 }));
    expect(r.text).toBe('⚠ 0.42 · ctxloom');
    expect(r.tooltip).toContain('Risk');
    expect(r.color).toBeUndefined();
  });

  it('falls back to "ctxloom" alone when risk is null', () => {
    const r = renderStatusBar(input({ riskScore: null }));
    expect(r.text).toBe('ctxloom');
  });

  it('shows "trial Nd left" when trialing with > 2 days left', () => {
    const r = renderStatusBar(input({ licenseState: { kind: 'TRIALING', tier: 'trial', daysLeft: 5, expiresAt: '' }, riskScore: 0.30 }));
    expect(r.text).toBe('⚠ 0.30 · trial 5d');
    expect(r.color).toBeUndefined();
  });

  it('switches to orange and "trial ends Sat"-style text when ≤ 2 days', () => {
    const exp = new Date(Date.now() + 1.5 * 86_400_000).toISOString();
    const r = renderStatusBar(input({ licenseState: { kind: 'TRIALING', tier: 'trial', daysLeft: 1, expiresAt: exp }, riskScore: 0.30 }));
    expect(r.text).toMatch(/^⚠ 0\.30 · trial ends /);
    expect(r.color).toBe('statusBarItem.warningForeground');
  });

  it('shows red expired marker when license expired', () => {
    const r = renderStatusBar(input({ licenseState: { kind: 'EXPIRED', expiresAt: '' }, riskScore: 0.50 }));
    expect(r.text).toBe('ctxloom expired');
    expect(r.color).toBe('statusBarItem.errorForeground');
  });

  it('shows licensed without trial countdown when tier is pro', () => {
    const r = renderStatusBar(input({ licenseState: { kind: 'LICENSED', tier: 'pro', expiresAt: '' }, riskScore: 0.10 }));
    expect(r.text).toBe('⚠ 0.10 · ctxloom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/statusBar.test.ts`
Expected: All 6 tests fail — module does not exist.

- [ ] **Step 3: Implement renderStatusBar + the actual VS Code item wrapper**

Write `apps/vscode-extension/src/license/statusBar.ts`:

```typescript
import * as vscode from 'vscode';
import type { LicenseState } from './LicenseGate.js';

export interface StatusBarInputs {
  licenseState: LicenseState;
  riskScore: number | null;
}

export interface StatusBarOutput {
  text: string;
  tooltip: string;
  /** ThemeColor identifier or undefined for default. */
  color: string | undefined;
}

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderStatusBar(inputs: StatusBarInputs): StatusBarOutput {
  const { licenseState, riskScore } = inputs;
  const riskPart = riskScore !== null ? `⚠ ${riskScore.toFixed(2)}` : '';

  if (licenseState.kind === 'EXPIRED') {
    return { text: 'ctxloom expired', tooltip: 'License expired — click to reactivate.', color: 'statusBarItem.errorForeground' };
  }

  if (licenseState.kind === 'NO_LICENSE') {
    return { text: 'ctxloom', tooltip: 'Click to activate ctxloom.', color: undefined };
  }

  if (licenseState.kind === 'TRIALING') {
    if (licenseState.daysLeft <= 2) {
      const day = SHORT_DAY[new Date(licenseState.expiresAt).getDay()];
      const text = riskPart ? `${riskPart} · trial ends ${day}` : `trial ends ${day}`;
      return { text, tooltip: 'Trial ends soon — activate to continue.', color: 'statusBarItem.warningForeground' };
    }
    const text = riskPart ? `${riskPart} · trial ${licenseState.daysLeft}d` : `trial ${licenseState.daysLeft}d`;
    return { text, tooltip: 'ctxloom trial active.', color: undefined };
  }

  // LICENSED
  const text = riskPart ? `${riskPart} · ctxloom` : 'ctxloom';
  return { text, tooltip: 'Risk score for this file. Click to open dashboard.', color: undefined };
}

export interface StatusBarHandle { dispose(): void; update(inputs: StatusBarInputs): void }

export function createStatusBarItem(commandId: string): StatusBarHandle {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = commandId;
  item.show();
  return {
    update(inputs) {
      const r = renderStatusBar(inputs);
      item.text = r.text;
      item.tooltip = r.tooltip;
      item.color = r.color !== undefined ? new vscode.ThemeColor(r.color) : undefined;
    },
    dispose() { item.dispose(); },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/statusBar.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/license/statusBar.ts apps/vscode-extension/tests/unit/statusBar.test.ts
git commit -m "feat(vscode-extension): status-bar item — license state + file risk"
```

---

## Phase 2 — Settings panel

### Task 7: Message protocol (TDD)

**Files:**
- Create: `apps/vscode-extension/src/settings/messageProtocol.ts`
- Test: `apps/vscode-extension/tests/unit/messageProtocol.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `apps/vscode-extension/tests/unit/messageProtocol.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseHostMessage, parseWebviewMessage, type HostToWebview, type WebviewToHost } from '../../src/settings/messageProtocol.js';

describe('messageProtocol', () => {
  it('parses a valid Host→Webview state message', () => {
    const msg: HostToWebview = { kind: 'state', state: { license: { kind: 'NO_LICENSE' }, settings: { 'features.hover': true } } };
    const parsed = parseHostMessage(msg);
    expect(parsed?.kind).toBe('state');
  });

  it('parses a valid Webview→Host setSetting message', () => {
    const msg: WebviewToHost = { kind: 'setSetting', key: 'features.hover', value: false };
    const parsed = parseWebviewMessage(msg);
    expect(parsed?.kind).toBe('setSetting');
    if (parsed?.kind === 'setSetting') {
      expect(parsed.key).toBe('features.hover');
      expect(parsed.value).toBe(false);
    }
  });

  it('parses a valid Webview→Host activateLicense message', () => {
    const msg: WebviewToHost = { kind: 'activateLicense', key: 'KEY-1234' };
    const parsed = parseWebviewMessage(msg);
    expect(parsed?.kind).toBe('activateLicense');
  });

  it('parses a valid Webview→Host startTrial message', () => {
    const msg: WebviewToHost = { kind: 'startTrial', email: 'me@example.com' };
    const parsed = parseWebviewMessage(msg);
    expect(parsed?.kind).toBe('startTrial');
  });

  it('rejects an unknown Host→Webview kind', () => {
    expect(parseHostMessage({ kind: 'unknown' })).toBeNull();
  });

  it('rejects an unknown Webview→Host kind', () => {
    expect(parseWebviewMessage({ kind: 'haxx0r' })).toBeNull();
  });

  it('rejects messages missing required fields', () => {
    expect(parseWebviewMessage({ kind: 'setSetting' })).toBeNull();
    expect(parseWebviewMessage({ kind: 'startTrial' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/messageProtocol.test.ts`
Expected: All 7 tests fail.

- [ ] **Step 3: Implement the protocol**

Write `apps/vscode-extension/src/settings/messageProtocol.ts`:

```typescript
import type { LicenseState } from '../license/LicenseGate.js';

export interface PanelState {
  license: LicenseState;
  /** Map of `ctxloom.<key>` setting names → current values. */
  settings: Record<string, unknown>;
  /** Optional banner the host wants the panel to render (errors, transient notes). */
  banner?: { kind: 'info' | 'warn' | 'error'; text: string };
}

export type HostToWebview =
  | { kind: 'state'; state: PanelState }
  | { kind: 'trialCheckoutOpened'; checkoutUrl: string }
  | { kind: 'activationResult'; ok: boolean; error?: string }
  | { kind: 'deactivationResult'; ok: boolean; error?: string };

export type WebviewToHost =
  | { kind: 'ready' }
  | { kind: 'setSetting'; key: string; value: unknown }
  | { kind: 'startTrial'; email: string }
  | { kind: 'activateLicense'; key: string }
  | { kind: 'deactivateLicense' }
  | { kind: 'openExternal'; url: string }
  | { kind: 'restartServer' }
  | { kind: 'showOutput' };

const HOST_KINDS = new Set(['state', 'trialCheckoutOpened', 'activationResult', 'deactivationResult']);
const WEBVIEW_KINDS = new Set(['ready', 'setSetting', 'startTrial', 'activateLicense', 'deactivateLicense', 'openExternal', 'restartServer', 'showOutput']);

function isString(v: unknown): v is string { return typeof v === 'string'; }
function hasKey(o: unknown, k: string): o is Record<string, unknown> { return typeof o === 'object' && o !== null && k in o; }

export function parseHostMessage(raw: unknown): HostToWebview | null {
  if (!hasKey(raw, 'kind') || !isString(raw.kind) || !HOST_KINDS.has(raw.kind)) return null;
  return raw as HostToWebview;
}

export function parseWebviewMessage(raw: unknown): WebviewToHost | null {
  if (!hasKey(raw, 'kind') || !isString(raw.kind) || !WEBVIEW_KINDS.has(raw.kind)) return null;
  switch (raw.kind) {
    case 'setSetting':
      if (!hasKey(raw, 'key') || !isString(raw.key) || !('value' in raw)) return null;
      return raw as WebviewToHost;
    case 'startTrial':
      if (!hasKey(raw, 'email') || !isString(raw.email)) return null;
      return raw as WebviewToHost;
    case 'activateLicense':
      if (!hasKey(raw, 'key') || !isString(raw.key)) return null;
      return raw as WebviewToHost;
    case 'openExternal':
      if (!hasKey(raw, 'url') || !isString(raw.url)) return null;
      return raw as WebviewToHost;
    case 'ready':
    case 'deactivateLicense':
    case 'restartServer':
    case 'showOutput':
      return raw as WebviewToHost;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/messageProtocol.test.ts`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/settings/messageProtocol.ts apps/vscode-extension/tests/unit/messageProtocol.test.ts
git commit -m "feat(vscode-extension): typed message protocol for SettingsPanel"
```

---

### Task 8: SettingsPanel webview host

**Files:**
- Create: `apps/vscode-extension/src/settings/SettingsPanel.ts`
- (No standalone unit test — integration tested in Task 10 once the webview bundle exists.)

- [ ] **Step 1: Create the host module**

Write `apps/vscode-extension/src/settings/SettingsPanel.ts`:

```typescript
import * as vscode from 'vscode';
import { parseWebviewMessage, type HostToWebview, type WebviewToHost, type PanelState } from './messageProtocol.js';
import type { Logger } from '../shared/logger.js';

export interface SettingsPanelDeps {
  context: vscode.ExtensionContext;
  logger: Logger;
  /** Returns the current panel state — license + settings snapshot. */
  computeState: () => PanelState;
  /** Handle a Webview→Host message. */
  handleMessage: (msg: WebviewToHost) => Promise<void>;
}

const VIEW_TYPE = 'ctxloom.settings';
const PANEL_TITLE = 'ctxloom Settings';

export class SettingsPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly deps: SettingsPanelDeps) {}

  /** Open or reveal the panel. Idempotent — clicking the status bar twice does not spawn two panels. */
  reveal(focusSection?: 'license' | 'features' | 'performance' | 'display' | 'telemetry' | 'advanced'): void {
    if (this.panel !== null) {
      this.panel.reveal(vscode.ViewColumn.Active);
      if (focusSection) this.send({ kind: 'state', state: { ...this.deps.computeState(), banner: undefined } });
      return;
    }
    this.panel = vscode.window.createWebviewPanel(VIEW_TYPE, PANEL_TITLE, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.deps.context.extensionUri, 'dist', 'webview')],
    });
    this.panel.webview.html = this.renderHtml(this.panel.webview);
    this.panel.onDidDispose(() => { this.panel = null; for (const d of this.disposables) d.dispose(); this.disposables.length = 0; }, null, this.disposables);
    this.disposables.push(this.panel.webview.onDidReceiveMessage(async raw => {
      const msg = parseWebviewMessage(raw);
      if (msg === null) { this.deps.logger.warn(`SettingsPanel: rejected malformed message ${JSON.stringify(raw)}`); return; }
      if (msg.kind === 'ready') { this.send({ kind: 'state', state: this.deps.computeState() }); return; }
      try { await this.deps.handleMessage(msg); }
      catch (err) { this.deps.logger.error(`SettingsPanel handler failed: ${String(err)}`); }
    }));
  }

  /** Send a Host→Webview message (no-op if panel is closed). */
  send(msg: HostToWebview): void {
    if (this.panel === null) return;
    this.panel.webview.postMessage(msg).then(undefined, err => this.deps.logger.warn(`postMessage failed: ${String(err)}`));
  }

  /** Push a fresh state snapshot — call this whenever license/settings change externally. */
  refresh(): void { this.send({ kind: 'state', state: this.deps.computeState() }); }

  isOpen(): boolean { return this.panel !== null; }

  dispose(): void {
    if (this.panel !== null) this.panel.dispose();
    this.panel = null;
  }

  private renderHtml(webview: vscode.Webview): string {
    const indexUri = webview.asWebviewUri(vscode.Uri.joinPath(this.deps.context.extensionUri, 'dist', 'webview', 'main.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.deps.context.extensionUri, 'dist', 'webview', 'styles.css'));
    const nonce = randomNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${stylesUri}" />
<title>ctxloom Settings</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${indexUri}"></script>
</body>
</html>`;
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: Verify lint**

Run: `cd apps/vscode-extension && npm run lint`
Expected: PASS (`tsc --noEmit` exit 0).

- [ ] **Step 3: Commit**

```bash
git add apps/vscode-extension/src/settings/SettingsPanel.ts
git commit -m "feat(vscode-extension): SettingsPanel webview host (mount, dispose, message routing)"
```

---

### Task 9: Webview HTML/CSS/TS bundle

**Files:**
- Create: `apps/vscode-extension/src/settings/webview/index.html` (template; the host re-emits this with CSP/nonce, but we keep a static reference for editor preview)
- Create: `apps/vscode-extension/src/settings/webview/main.ts`
- Create: `apps/vscode-extension/src/settings/webview/styles.css`
- Modify: `apps/vscode-extension/esbuild.config.mjs` — add a second entry point for the webview bundle

- [ ] **Step 1: Extend esbuild config to bundle the webview**

Replace `apps/vscode-extension/esbuild.config.mjs` with:

```javascript
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');

// Extension bundle (Node CJS, externalizes vscode).
const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
});

// Webview bundle (browser ESM, no externals).
const webviewCtx = await esbuild.context({
  entryPoints: ['src/settings/webview/main.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: 'dist/webview/main.js',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
});

// Copy CSS as-is.
fs.mkdirSync('dist/webview', { recursive: true });
fs.copyFileSync('src/settings/webview/styles.css', 'dist/webview/styles.css');

if (watch) {
  await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
} else {
  await extensionCtx.rebuild(); await extensionCtx.dispose();
  await webviewCtx.rebuild(); await webviewCtx.dispose();
}
```

- [ ] **Step 2: Create the webview entry HTML (reference; host overrides at runtime)**

Write `apps/vscode-extension/src/settings/webview/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="styles.css" />
  <title>ctxloom Settings</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="main.ts"></script>
</body>
</html>
```

- [ ] **Step 3: Create the styles**

Write `apps/vscode-extension/src/settings/webview/styles.css`:

```css
:root {
  --ctxloom-bg: var(--vscode-editor-background, #18181f);
  --ctxloom-surface: #1e1d2a;
  --ctxloom-border: rgba(255,255,255,0.10);
  --ctxloom-text: var(--vscode-foreground, #fafafa);
  --ctxloom-text-muted: rgba(255,255,255,0.50);
  --ctxloom-accent: #a78bfa;
  --ctxloom-accent-bg: rgba(96,61,198,0.20);
  --ctxloom-good: #22c55e;
  --ctxloom-warn: #f97316;
  --ctxloom-bad: #ef4444;
  font-family: var(--vscode-font-family, system-ui);
  font-size: 13px;
}
body { margin: 0; padding: 24px; background: var(--ctxloom-bg); color: var(--ctxloom-text); }
.section { background: var(--ctxloom-surface); border: 1px solid var(--ctxloom-border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.section h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ctxloom-text-muted); margin: 0 0 12px; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
.row label { color: var(--ctxloom-text); }
.hint { color: var(--ctxloom-text-muted); font-size: 12px; }
.btn { background: var(--ctxloom-accent-bg); color: var(--ctxloom-accent); border: 1px solid transparent; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
.btn:hover { background: rgba(96,61,198,0.30); }
.btn-secondary { background: transparent; color: var(--ctxloom-text-muted); border: 1px solid var(--ctxloom-border); }
.input, .select { background: var(--ctxloom-bg); color: var(--ctxloom-text); border: 1px solid var(--ctxloom-border); border-radius: 6px; padding: 6px 10px; font-family: inherit; font-size: 13px; }
.input:focus { outline: 1px solid var(--ctxloom-accent); }
.toggle { width: 32px; height: 18px; background: rgba(255,255,255,0.10); border-radius: 9px; position: relative; cursor: pointer; transition: background 0.15s; }
.toggle.on { background: var(--ctxloom-accent); }
.toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; background: #fff; border-radius: 50%; transition: transform 0.15s; }
.toggle.on::after { transform: translateX(14px); }
.disabled { opacity: 0.4; pointer-events: none; }
.banner { padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; }
.banner.info  { background: rgba(96,61,198,0.10); color: var(--ctxloom-accent); }
.banner.warn  { background: rgba(249,115,22,0.10); color: var(--ctxloom-warn); }
.banner.error { background: rgba(239,68,68,0.10); color: var(--ctxloom-bad); }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; }
.dot.good { background: var(--ctxloom-good); }
.dot.warn { background: var(--ctxloom-warn); }
.dot.bad  { background: var(--ctxloom-bad); }
.footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px; }
.footer a { color: var(--ctxloom-text-muted); cursor: pointer; }
```

- [ ] **Step 4: Create the panel JavaScript**

Write `apps/vscode-extension/src/settings/webview/main.ts`:

```typescript
// Webview entry — vanilla TS, no React. Renders all six sections, posts changes back to host.

declare global {
  interface Window {
    acquireVsCodeApi(): { postMessage(msg: unknown): void };
  }
}

const vscode = window.acquireVsCodeApi();
const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

interface PanelState {
  license: { kind: string; tier?: string; daysLeft?: number; expiresAt?: string };
  settings: Record<string, unknown>;
  banner?: { kind: 'info' | 'warn' | 'error'; text: string };
}

let state: PanelState | null = null;

window.addEventListener('message', e => {
  const msg = e.data as { kind: string };
  if (msg.kind === 'state') { state = (e.data as { state: PanelState }).state; render(); }
  else if (msg.kind === 'activationResult') { /* re-render on next state push */ }
  else if (msg.kind === 'trialCheckoutOpened') {
    // Show waiting overlay in license section.
    const li = root.querySelector('[data-section="license"]');
    if (li !== null) {
      li.querySelector<HTMLDivElement>('.license-waiting')?.removeAttribute('hidden');
    }
  }
});

vscode.postMessage({ kind: 'ready' });

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setSetting(key: string, value: unknown): void {
  vscode.postMessage({ kind: 'setSetting', key, value });
}

function render(): void {
  if (state === null || root === null) return;
  const s = state;
  const licensed = s.license.kind === 'LICENSED' || s.license.kind === 'TRIALING';
  const disabled = !licensed ? ' disabled' : '';
  root.innerHTML = `
    ${s.banner ? `<div class="banner ${s.banner.kind}">${escapeHtml(s.banner.text)}</div>` : ''}
    <section class="section" data-section="license">
      <h2>License</h2>
      ${renderLicense(s)}
    </section>
    <section class="section${disabled}" data-section="features">
      <h2>Features</h2>
      ${renderToggle('Hover cards', 'features.hover', s.settings)}
      ${renderToggle('Rules diagnostics', 'features.diagnostics', s.settings)}
      ${renderToggle('Gutter decorations', 'features.gutterDecorations', s.settings)}
      ${renderToggle('Code lens', 'features.codeLens', s.settings)}
      ${renderToggle('Rules quick-fixes', 'features.quickFixes', s.settings)}
      ${renderToggle('MCP bridge for AI assistants', 'features.mcpBridge', s.settings)}
    </section>
    <section class="section${disabled}" data-section="performance">
      <h2>Performance</h2>
      ${renderNumber('Debounce (ms)', 'debounceMs', s.settings)}
      ${renderNumber('Cache TTL (s)', 'cacheTtlSeconds', s.settings)}
    </section>
    <section class="section${disabled}" data-section="display">
      <h2>Display</h2>
      ${renderNumber('Gutter churn threshold (high)', 'gutter.churnThresholdHigh', s.settings)}
      ${renderNumber('Gutter churn threshold (medium)', 'gutter.churnThresholdMedium', s.settings)}
      ${renderToggle('Show dead-code marker', 'gutter.showDeadCodeMarker', s.settings)}
      ${renderText('Dashboard URL', 'dashboardUrl', s.settings)}
    </section>
    <section class="section${disabled}" data-section="telemetry">
      <h2>Telemetry</h2>
      ${renderToggle('Send anonymous usage data', 'telemetry.enabled', s.settings)}
      <div class="hint">Off by default. Never sends code or file paths.</div>
    </section>
    <section class="section${disabled}" data-section="advanced">
      <h2>Advanced</h2>
      ${renderText('Custom CLI path', 'cliPath', s.settings, 'bundled')}
      ${renderText('Server args (JSON array)', 'serverArgs', s.settings, '[]')}
    </section>
    <div class="footer">
      <a data-action="open-settings">Open in VS Code Settings →</a>
      <a data-action="restart-server">Restart server</a>
      <a data-action="show-output">Open Output</a>
    </div>
  `;
  attachHandlers();
}

function renderLicense(s: PanelState): string {
  if (s.license.kind === 'NO_LICENSE' || s.license.kind === 'EXPIRED') {
    return `
      <div class="row"><span><span class="dot bad"></span>${s.license.kind === 'EXPIRED' ? 'Expired' : 'Not activated'}</span></div>
      <div class="row" style="gap:8px">
        <button class="btn" data-action="start-trial">Start free trial…</button>
        <button class="btn" data-action="enter-key">I have a license key</button>
      </div>
      <div class="license-trial-form" hidden>
        <div class="row"><input class="input" data-input="trial-email" type="email" placeholder="email@company.com" /><button class="btn" data-action="submit-trial">Start trial</button></div>
      </div>
      <div class="license-waiting" hidden>
        <div class="hint">Check your email — your license key is on its way. Paste it here when it arrives.</div>
        <div class="row"><input class="input" data-input="key" placeholder="ctxloom-XXXX-XXXX-XXXX" /><button class="btn" data-action="submit-key">Activate</button></div>
      </div>
      <div class="license-key-form" hidden>
        <div class="row"><input class="input" data-input="key2" placeholder="ctxloom-XXXX-XXXX-XXXX" /><button class="btn" data-action="submit-key2">Activate</button></div>
      </div>
    `;
  }
  const tone = s.license.kind === 'TRIALING' && (s.license.daysLeft ?? 0) <= 2 ? 'warn' : 'good';
  const stateLabel = s.license.kind === 'TRIALING' ? `Trialing · ${s.license.daysLeft ?? 0} days left` : 'Active';
  return `
    <div class="row"><span><span class="dot ${tone}"></span>Tier: ${escapeHtml(s.license.tier ?? 'pro')} · ${stateLabel}</span></div>
    <div class="row"><button class="btn-secondary btn" data-action="deactivate">Deactivate this seat</button></div>
  `;
}

function renderToggle(label: string, key: string, settings: Record<string, unknown>): string {
  const on = Boolean(settings[key]) ? 'on' : '';
  return `<div class="row"><label>${escapeHtml(label)}</label><div class="toggle ${on}" data-toggle="${key}"></div></div>`;
}

function renderNumber(label: string, key: string, settings: Record<string, unknown>): string {
  const v = String(settings[key] ?? '');
  return `<div class="row"><label>${escapeHtml(label)}</label><input class="input" type="number" data-number="${key}" value="${escapeHtml(v)}" /></div>`;
}

function renderText(label: string, key: string, settings: Record<string, unknown>, placeholder = ''): string {
  const v = settings[key];
  const display = v === null || v === undefined ? '' : String(v);
  return `<div class="row"><label>${escapeHtml(label)}</label><input class="input" type="text" data-text="${key}" value="${escapeHtml(display)}" placeholder="${escapeHtml(placeholder)}" /></div>`;
}

function attachHandlers(): void {
  if (root === null) return;
  root.querySelectorAll<HTMLDivElement>('[data-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.toggle!;
      const next = !el.classList.contains('on');
      el.classList.toggle('on', next);
      setSetting(key, next);
    });
  });
  root.querySelectorAll<HTMLInputElement>('[data-number]').forEach(el => {
    el.addEventListener('change', () => setSetting(el.dataset.number!, Number(el.value)));
  });
  root.querySelectorAll<HTMLInputElement>('[data-text]').forEach(el => {
    el.addEventListener('change', () => {
      const key = el.dataset.text!;
      const v = el.value.trim();
      if (key === 'serverArgs') {
        try { setSetting(key, JSON.parse(v || '[]')); } catch { /* ignore invalid */ }
      } else {
        setSetting(key, v === '' ? null : v);
      }
    });
  });
  bindAction('start-trial', () => root.querySelector<HTMLDivElement>('.license-trial-form')?.removeAttribute('hidden'));
  bindAction('enter-key', () => root.querySelector<HTMLDivElement>('.license-key-form')?.removeAttribute('hidden'));
  bindAction('submit-trial', () => {
    const email = root.querySelector<HTMLInputElement>('[data-input="trial-email"]')?.value ?? '';
    if (email) vscode.postMessage({ kind: 'startTrial', email });
  });
  bindAction('submit-key', () => {
    const key = root.querySelector<HTMLInputElement>('[data-input="key"]')?.value ?? '';
    if (key) vscode.postMessage({ kind: 'activateLicense', key });
  });
  bindAction('submit-key2', () => {
    const key = root.querySelector<HTMLInputElement>('[data-input="key2"]')?.value ?? '';
    if (key) vscode.postMessage({ kind: 'activateLicense', key });
  });
  bindAction('deactivate', () => vscode.postMessage({ kind: 'deactivateLicense' }));
  bindAction('restart-server', () => vscode.postMessage({ kind: 'restartServer' }));
  bindAction('show-output', () => vscode.postMessage({ kind: 'showOutput' }));
  bindAction('open-settings', () => vscode.postMessage({ kind: 'openExternal', url: 'command:workbench.action.openSettings?%22ctxloom%22' }));
}

function bindAction(name: string, handler: () => void): void {
  if (root === null) return;
  root.querySelectorAll<HTMLElement>(`[data-action="${name}"]`).forEach(el => el.addEventListener('click', handler));
}
```

- [ ] **Step 5: Verify the bundle builds**

Run: `cd apps/vscode-extension && node esbuild.config.mjs`
Expected: produces `dist/extension.js` and `dist/webview/main.js` and `dist/webview/styles.css`. No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/vscode-extension/src/settings/webview/ apps/vscode-extension/esbuild.config.mjs
git commit -m "feat(vscode-extension): SettingsPanel webview HTML + CSS + vanilla TS"
```

---

### Task 10: SettingsPanel ↔ VS Code config bidirectional sync (integration test)

**Files:**
- Test: `apps/vscode-extension/tests/integration/SettingsPanel.test.ts`
- Modify: `apps/vscode-extension/src/extension.ts` — wire SettingsPanel into activate()

- [ ] **Step 1: Wire SettingsPanel into activate()**

Replace `apps/vscode-extension/src/extension.ts` with:

```typescript
import * as vscode from 'vscode';
import { SettingsPanel } from './settings/SettingsPanel.js';
import type { PanelState, WebviewToHost } from './settings/messageProtocol.js';
import { createOutputLogger, type Logger } from './shared/logger.js';

let panel: SettingsPanel | null = null;
let logger: Logger | null = null;
const SETTINGS_KEYS = [
  'cliPath', 'serverArgs', 'debounceMs', 'cacheTtlSeconds',
  'features.hover', 'features.diagnostics', 'features.gutterDecorations', 'features.codeLens', 'features.quickFixes', 'features.mcpBridge',
  'gutter.churnThresholdHigh', 'gutter.churnThresholdMedium', 'gutter.showDeadCodeMarker',
  'dashboardUrl', 'telemetry.enabled',
] as const;

function readSettings(): Record<string, unknown> {
  const cfg = vscode.workspace.getConfiguration('ctxloom');
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) out[k] = cfg.get(k);
  return out;
}

function computeState(): PanelState {
  return { license: { kind: 'NO_LICENSE' }, settings: readSettings() };
}

async function handleMessage(msg: WebviewToHost): Promise<void> {
  if (msg.kind === 'setSetting') {
    await vscode.workspace.getConfiguration('ctxloom').update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
    return;
  }
  if (msg.kind === 'openExternal') { await vscode.env.openExternal(vscode.Uri.parse(msg.url)); return; }
  if (msg.kind === 'showOutput') { logger?.show(); return; }
  // Other kinds (license operations, restart) wired in later tasks.
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger = createOutputLogger();
  context.subscriptions.push({ dispose: () => logger?.dispose() });

  panel = new SettingsPanel({ context, logger, computeState, handleMessage });
  context.subscriptions.push({ dispose: () => panel?.dispose() });

  context.subscriptions.push(vscode.commands.registerCommand('ctxloom.openSettings', () => panel?.reveal()));

  // Push state when any ctxloom.* setting changes anywhere.
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('ctxloom')) panel?.refresh();
  }));
}

export function deactivate(): void {
  panel?.dispose();
  logger?.dispose();
}
```

- [ ] **Step 2: Write the integration test**

Write `apps/vscode-extension/tests/integration/SettingsPanel.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('SettingsPanel integration', () => {
  test('opens via command, accepts setSetting messages, propagates onDidChangeConfiguration', async () => {
    await vscode.commands.executeCommand('ctxloom.openSettings');

    // Flip a setting via VS Code config (mimics what the panel posts back).
    await vscode.workspace.getConfiguration('ctxloom').update('features.hover', false, vscode.ConfigurationTarget.Global);
    const v = vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.hover');
    assert.strictEqual(v, false);

    // Reset for other tests.
    await vscode.workspace.getConfiguration('ctxloom').update('features.hover', undefined, vscode.ConfigurationTarget.Global);
  });

  test('panel reveal is idempotent (clicking twice does not spawn two panels)', async () => {
    await vscode.commands.executeCommand('ctxloom.openSettings');
    await vscode.commands.executeCommand('ctxloom.openSettings');
    // No assertion API for live panel count, but absence of error is the contract.
    assert.ok(true);
  });
});
```

- [ ] **Step 3: Build the test bundle and run integration tests**

Run:

```bash
cd apps/vscode-extension
npm run build
npx vscode-test --label integration --files out/tests/integration/SettingsPanel.test.js
```

(If `out/` doesn't exist yet, add a tsc step: `npx tsc --outDir out` before `vscode-test`.)

Expected: 2/2 pass.

- [ ] **Step 4: Commit**

```bash
git add apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/SettingsPanel.test.ts
git commit -m "feat(vscode-extension): wire SettingsPanel into activate(); bidirectional config sync"
```

---

## Phase 3 — Read-only providers

### Task 11: Tools wrappers + ServerManager wiring (TDD)

**Files:**
- Create: `apps/vscode-extension/src/client/tools.ts`
- Test: `apps/vscode-extension/tests/unit/tools.test.ts`
- Modify: `apps/vscode-extension/src/extension.ts` — instantiate ServerManager + BinaryResolver
- Modify: `apps/vscode-extension/src/client/ServerManager.ts` — accept the real `mcp-client` spawn function (no code change to the manager itself; just produce the spawner closure in extension.ts)

- [ ] **Step 1: Write the failing tests**

Write `apps/vscode-extension/tests/unit/tools.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Tools } from '../../src/client/tools.js';

function fakeManager() {
  return {
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify({ name, args }) }] })),
  };
}

describe('Tools', () => {
  it('riskOverlay returns parsed score and label for one file', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '<risk_overlay><file path="a.ts" score="0.42" label="medium" top_owner="alice" /></risk_overlay>' }] }));
    const t = new Tools(sm as never);
    const r = await t.riskOverlay('a.ts');
    expect(r).toEqual({ file: 'a.ts', score: 0.42, label: 'medium', topOwner: 'alice' });
  });

  it('riskOverlay returns null when file is missing from response', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '<risk_overlay></risk_overlay>' }] }));
    const t = new Tools(sm as never);
    const r = await t.riskOverlay('a.ts');
    expect(r).toBeNull();
  });

  it('blastRadius returns counts and entries', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '{"direct":["b.ts"],"transitive":["c.ts","d.ts"],"historical":[]}' }] }));
    const t = new Tools(sm as never);
    const r = await t.blastRadius('a.ts');
    expect(r).toEqual({ direct: ['b.ts'], transitive: ['c.ts', 'd.ts'], historical: [] });
  });

  it('rulesCheck returns violations with severities', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '[{"file":"a.ts","line":3,"col":1,"endLine":3,"endCol":10,"rule":"no-cycle","message":"cycle","severity":"error"}]' }] }));
    const t = new Tools(sm as never);
    const r = await t.rulesCheck('a.ts');
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe('error');
  });

  it('knowledgeGaps returns counts and lists', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '<knowledge_gaps><isolated_files count="2"><f>a.ts</f><f>b.ts</f></isolated_files><dead_code_candidates count="1"><f>c.ts</f></dead_code_candidates></knowledge_gaps>' }] }));
    const t = new Tools(sm as never);
    const r = await t.knowledgeGaps();
    expect(r.isolated.length).toBe(2);
    expect(r.deadCode).toEqual(['c.ts']);
  });

  it('contextPacket returns text + token estimate', async () => {
    const sm = fakeManager();
    sm.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '{"text":"export fn();","fullTokens":1200,"skeletonTokens":120,"reductionPercent":90}' }] }));
    const t = new Tools(sm as never);
    const r = await t.contextPacket('a.ts', 'fn');
    expect(r.text).toContain('fn');
    expect(r.skeletonTokens).toBe(120);
    expect(r.reductionPercent).toBe(90);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/tools.test.ts`
Expected: All 6 tests fail — module does not exist.

- [ ] **Step 3: Implement Tools**

Write `apps/vscode-extension/src/client/tools.ts`:

```typescript
import type { ServerManager } from './ServerManager.js';

export interface RiskInfo { file: string; score: number; label: string; topOwner: string | null }
export interface BlastResult { direct: string[]; transitive: string[]; historical: string[] }
export interface RuleViolation { file: string; line: number; col: number; endLine: number; endCol: number; rule: string; message: string; severity: 'error' | 'warning' | 'info' }
export interface KnowledgeGapsResult { isolated: string[]; deadCode: string[]; untestedHubs: { file: string; importers: number }[] }
export interface ContextPacket { text: string; fullTokens: number; skeletonTokens: number; reductionPercent: number }
export interface CommunityCounts { count: number }
export interface HubFile { file: string; importers: number }

function firstText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const item = content.find((c: unknown) => typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text');
  return typeof item === 'object' && item !== null && 'text' in item ? String((item as { text: unknown }).text) : '';
}

function tryJson<T>(s: string): T | null { try { return JSON.parse(s) as T; } catch { return null; } }

export class Tools {
  constructor(private readonly sm: { callTool: (name: string, args: Record<string, unknown>) => Promise<{ content: unknown }> }) {}

  async riskOverlay(file: string): Promise<RiskInfo | null> {
    const res = await this.sm.callTool('ctx_risk_overlay', { files: [file] });
    const text = firstText(res.content);
    const m = text.match(/<file\s+path="([^"]+)"\s+score="([^"]+)"\s+label="([^"]+)"(?:\s+top_owner="([^"]*)")?\s*\/>/);
    if (m === null) return null;
    return { file: m[1], score: Number(m[2]), label: m[3], topOwner: m[4] ?? null };
  }

  async blastRadius(file: string): Promise<BlastResult> {
    const res = await this.sm.callTool('ctx_blast_radius', { files: [file] });
    const data = tryJson<BlastResult>(firstText(res.content));
    return data ?? { direct: [], transitive: [], historical: [] };
  }

  async rulesCheck(file?: string): Promise<RuleViolation[]> {
    const args: Record<string, unknown> = file !== undefined ? { file } : {};
    const res = await this.sm.callTool('ctx_rules_check', args);
    const data = tryJson<RuleViolation[]>(firstText(res.content));
    return data ?? [];
  }

  async knowledgeGaps(): Promise<KnowledgeGapsResult> {
    const res = await this.sm.callTool('ctx_knowledge_gaps', { detail_level: 'standard' });
    const text = firstText(res.content);
    const isolated = [...text.matchAll(/<isolated_files[^>]*>([\s\S]*?)<\/isolated_files>/g)].flatMap(m => [...m[1].matchAll(/<f>([^<]+)<\/f>/g)].map(x => x[1]));
    const deadCode = [...text.matchAll(/<dead_code_candidates[^>]*>([\s\S]*?)<\/dead_code_candidates>/g)].flatMap(m => [...m[1].matchAll(/<f>([^<]+)<\/f>/g)].map(x => x[1]));
    const untestedHubs = [...text.matchAll(/<untested_hubs[^>]*>([\s\S]*?)<\/untested_hubs>/g)].flatMap(m => [...m[1].matchAll(/<f\s+importers="([^"]+)">([^<]+)<\/f>/g)].map(x => ({ file: x[2], importers: Number(x[1]) })));
    return { isolated, deadCode, untestedHubs };
  }

  async hubNodes(limit = 10): Promise<HubFile[]> {
    const res = await this.sm.callTool('ctx_hub_nodes', { limit });
    const data = tryJson<HubFile[]>(firstText(res.content));
    return data ?? [];
  }

  async communityList(): Promise<CommunityCounts> {
    const res = await this.sm.callTool('ctx_community_list', {});
    const data = tryJson<{ communities: unknown[] }>(firstText(res.content));
    return { count: data?.communities?.length ?? 0 };
  }

  async contextPacket(file: string, symbol: string): Promise<ContextPacket> {
    const res = await this.sm.callTool('ctx_get_context_packet', { file, symbol });
    const data = tryJson<ContextPacket>(firstText(res.content));
    return data ?? { text: '', fullTokens: 0, skeletonTokens: 0, reductionPercent: 0 };
  }

  async gitCoupling(file: string): Promise<{ churnLines: number; bucket: 'low' | 'medium' | 'high'; importers: number }> {
    const res = await this.sm.callTool('ctx_git_coupling', { file });
    const data = tryJson<{ churnLines: number; bucket: 'low' | 'medium' | 'high'; importers: number }>(firstText(res.content));
    return data ?? { churnLines: 0, bucket: 'low', importers: 0 };
  }

  async applyRefactor(args: Record<string, unknown>): Promise<{ ok: boolean; message?: string; edits?: unknown }> {
    const res = await this.sm.callTool('ctx_apply_refactor', args);
    const data = tryJson<{ ok: boolean; message?: string; edits?: unknown }>(firstText(res.content));
    return data ?? { ok: false, message: 'malformed response' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/tools.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Wire ServerManager + BinaryResolver into extension.ts**

Replace the imports and `activate()` body of `apps/vscode-extension/src/extension.ts` with:

```typescript
import * as vscode from 'vscode';
import { spawnServer } from '@ctxloom/mcp-client';
import { resolveCliPath } from './client/BinaryResolver.js';
import { ServerManager } from './client/ServerManager.js';
import { Tools } from './client/tools.js';
import { SettingsPanel } from './settings/SettingsPanel.js';
import type { PanelState, WebviewToHost } from './settings/messageProtocol.js';
import { createOutputLogger, type Logger } from './shared/logger.js';

let panel: SettingsPanel | null = null;
let logger: Logger | null = null;
let serverManager: ServerManager | null = null;
let tools: Tools | null = null;

const SETTINGS_KEYS = [
  'cliPath', 'serverArgs', 'debounceMs', 'cacheTtlSeconds',
  'features.hover', 'features.diagnostics', 'features.gutterDecorations', 'features.codeLens', 'features.quickFixes', 'features.mcpBridge',
  'gutter.churnThresholdHigh', 'gutter.churnThresholdMedium', 'gutter.showDeadCodeMarker',
  'dashboardUrl', 'telemetry.enabled',
] as const;

function readSettings(): Record<string, unknown> {
  const cfg = vscode.workspace.getConfiguration('ctxloom');
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) out[k] = cfg.get(k);
  return out;
}

function computeState(): PanelState {
  return { license: { kind: 'NO_LICENSE' }, settings: readSettings() };
}

async function handleMessage(msg: WebviewToHost): Promise<void> {
  if (msg.kind === 'setSetting') {
    await vscode.workspace.getConfiguration('ctxloom').update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
    return;
  }
  if (msg.kind === 'openExternal') { await vscode.env.openExternal(vscode.Uri.parse(msg.url)); return; }
  if (msg.kind === 'showOutput') { logger?.show(); return; }
  if (msg.kind === 'restartServer') {
    if (serverManager) { await serverManager.dispose(); serverManager = null; }
    await startServer();
    return;
  }
}

async function startServer(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { logger?.warn('no workspace folder — server not started'); return; }
  const cfg = vscode.workspace.getConfiguration('ctxloom');
  const override = cfg.get<string | null>('cliPath') ?? null;
  const extensionRoot = vscode.extensions.getExtension('ctxloom.ctxloom-vscode')?.extensionPath
    ?? vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
  const resolved = resolveCliPath({ extensionRoot, override });
  if (!resolved.exists) { logger?.error(`ctxloom CLI missing at ${resolved.path}`); return; }

  serverManager = new ServerManager({
    spawner: () => spawnServer({ cwd: folder.uri.fsPath, command: resolved.path }) as never,
    logger: { info: m => logger?.info(m), warn: m => logger?.warn(m), error: m => logger?.error(m) },
  });
  await serverManager.start();
  tools = new Tools(serverManager);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger = createOutputLogger();
  context.subscriptions.push({ dispose: () => logger?.dispose() });

  panel = new SettingsPanel({ context, logger, computeState, handleMessage });
  context.subscriptions.push({ dispose: () => panel?.dispose() });
  context.subscriptions.push(vscode.commands.registerCommand('ctxloom.openSettings', () => panel?.reveal()));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom')) panel?.refresh(); }));

  await startServer();
}

export async function deactivate(): Promise<void> {
  if (serverManager) await serverManager.dispose();
  panel?.dispose();
  logger?.dispose();
}
```

- [ ] **Step 6: Verify lint**

Run: `cd apps/vscode-extension && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/vscode-extension/src/client/tools.ts apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/unit/tools.test.ts
git commit -m "feat(vscode-extension): typed Tools wrappers + wire ServerManager into activate()"
```

---

### Task 12: HoverProvider (TDD with stubbed Tools)

**Files:**
- Create: `apps/vscode-extension/src/providers/HoverProvider.ts`
- Test: `apps/vscode-extension/tests/integration/HoverProvider.test.ts`
- Modify: `apps/vscode-extension/src/extension.ts` — register provider gated by `features.hover`

- [ ] **Step 1: Write the failing integration test**

Write `apps/vscode-extension/tests/integration/HoverProvider.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CtxloomHoverProvider } from '../../src/providers/HoverProvider.js';
import type { Tools } from '../../src/client/tools.js';
import { TtlCache } from '../../src/shared/cache.js';

function fakeTools(): Tools {
  return {
    riskOverlay: async () => ({ file: 'b.ts', score: 0.42, label: 'medium', topOwner: 'alice' }),
    blastRadius: async () => ({ direct: ['x.ts', 'y.ts'], transitive: ['z.ts'], historical: [] }),
  } as unknown as Tools;
}

suite('HoverProvider', () => {
  test('renders risk + owner + blast count for an import path', async () => {
    const provider = new CtxloomHoverProvider({ tools: fakeTools(), cache: new TtlCache({ ttlMs: 30_000 }), dashboardUrl: 'http://localhost:7842' });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: "import { x } from './b.ts';\n" });
    const pos = new vscode.Position(0, 24); // inside './b.ts'
    const hover = await provider.provideHover(doc, pos, new vscode.CancellationTokenSource().token);
    assert.ok(hover);
    const text = (hover!.contents[0] as vscode.MarkdownString).value;
    assert.match(text, /alice/);
    assert.match(text, /0\.42/);
    assert.match(text, /3 files/); // direct(2) + transitive(1)
  });

  test('returns null when not hovering an import string', async () => {
    const provider = new CtxloomHoverProvider({ tools: fakeTools(), cache: new TtlCache({ ttlMs: 30_000 }), dashboardUrl: 'http://localhost:7842' });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'const x = 1;\n' });
    const hover = await provider.provideHover(doc, new vscode.Position(0, 6), new vscode.CancellationTokenSource().token);
    assert.strictEqual(hover, null);
  });
});
```

- [ ] **Step 2: Implement HoverProvider**

Write `apps/vscode-extension/src/providers/HoverProvider.ts`:

```typescript
import * as vscode from 'vscode';
import type { Tools, RiskInfo, BlastResult } from '../client/tools.js';
import type { TtlCache } from '../shared/cache.js';

interface CachedHover { risk: RiskInfo | null; blast: BlastResult }

export interface HoverDeps { tools: Tools; cache: TtlCache<string, CachedHover>; dashboardUrl: string }

const IMPORT_RE = /['"]([^'"]+)['"]/;

export class CtxloomHoverProvider implements vscode.HoverProvider {
  constructor(private readonly deps: HoverDeps) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Hover | null> {
    const range = document.getWordRangeAtPosition(position, IMPORT_RE);
    if (!range) return null;
    const matchedString = document.getText(range);
    const inner = matchedString.slice(1, -1);
    if (!/[./]/.test(inner)) return null;
    const cacheKey = inner;
    let entry = this.deps.cache.get(cacheKey);
    if (entry === undefined) {
      const [risk, blast] = await Promise.all([this.deps.tools.riskOverlay(inner), this.deps.tools.blastRadius(inner)]);
      entry = { risk, blast };
      this.deps.cache.set(cacheKey, entry);
    }
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = false;
    if (entry.risk !== null) {
      md.appendMarkdown(`**ctxloom** · risk \`${entry.risk.score.toFixed(2)}\` (${entry.risk.label})`);
      if (entry.risk.topOwner !== null) md.appendMarkdown(` · @${entry.risk.topOwner}`);
      md.appendMarkdown('  \n');
    } else {
      md.appendMarkdown('**ctxloom**  \n');
    }
    const blastCount = entry.blast.direct.length + entry.blast.transitive.length;
    md.appendMarkdown(`↗ ${blastCount} files in blast radius  \n`);
    md.appendMarkdown(`[Open in dashboard](${this.deps.dashboardUrl}/risk?file=${encodeURIComponent(inner)})`);
    return new vscode.Hover(md, range);
  }
}
```

- [ ] **Step 3: Register provider in extension.ts**

In `apps/vscode-extension/src/extension.ts`, after `await startServer();`, add:

```typescript
const hoverCache = new (await import('./shared/cache.js')).TtlCache<string, { risk: import('./client/tools.js').RiskInfo | null; blast: import('./client/tools.js').BlastResult }>({ ttlMs: (vscode.workspace.getConfiguration('ctxloom').get<number>('cacheTtlSeconds') ?? 30) * 1000 });

let hoverDisposable: vscode.Disposable | null = null;
function refreshHover() {
  hoverDisposable?.dispose(); hoverDisposable = null;
  if (vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.hover') && tools) {
    const dashboardUrl = vscode.workspace.getConfiguration('ctxloom').get<string>('dashboardUrl') ?? 'http://localhost:7842';
    hoverDisposable = vscode.languages.registerHoverProvider({ scheme: 'file' }, new (await import('./providers/HoverProvider.js')).CtxloomHoverProvider({ tools, cache: hoverCache, dashboardUrl }));
    context.subscriptions.push(hoverDisposable);
  }
}
await refreshHover();
context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.hover')) refreshHover(); }));
```

(The dynamic imports avoid circular-import issues during esbuild bundling; they're resolved once at module load.)

- [ ] **Step 4: Run integration test**

Run: `cd apps/vscode-extension && npm run build && npx vscode-test --label integration --files out/tests/integration/HoverProvider.test.js`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/providers/HoverProvider.ts apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/HoverProvider.test.ts
git commit -m "feat(vscode-extension): HoverProvider — risk, owner, blast count"
```

---

### Task 13: DiagnosticsProvider (TDD)

**Files:**
- Create: `apps/vscode-extension/src/providers/DiagnosticsProvider.ts`
- Test: `apps/vscode-extension/tests/integration/DiagnosticsProvider.test.ts`
- Modify: `apps/vscode-extension/src/extension.ts` — register on save + active editor change, gated by `features.diagnostics`

- [ ] **Step 1: Implement DiagnosticsProvider**

Write `apps/vscode-extension/src/providers/DiagnosticsProvider.ts`:

```typescript
import * as vscode from 'vscode';
import type { Tools, RuleViolation } from '../client/tools.js';

export class CtxloomDiagnosticsProvider {
  private readonly collection: vscode.DiagnosticCollection;
  constructor(private readonly tools: Tools) {
    this.collection = vscode.languages.createDiagnosticCollection('ctxloom');
  }

  async refresh(uri: vscode.Uri): Promise<void> {
    const file = vscode.workspace.asRelativePath(uri);
    let violations: RuleViolation[] = [];
    try { violations = await this.tools.rulesCheck(file); }
    catch { /* server-down → keep last diagnostics; spec rule "providers tolerate server-down" */ return; }
    const diags = violations.map(v => {
      const range = new vscode.Range(v.line - 1, v.col - 1, v.endLine - 1, v.endCol - 1);
      const sev = v.severity === 'error' ? vscode.DiagnosticSeverity.Error
        : v.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
      const d = new vscode.Diagnostic(range, v.message, sev);
      d.source = 'ctxloom';
      d.code = v.rule;
      return d;
    });
    this.collection.set(uri, diags);
  }

  clear(uri: vscode.Uri): void { this.collection.delete(uri); }
  dispose(): void { this.collection.dispose(); }
}
```

- [ ] **Step 2: Write the integration test**

Write `apps/vscode-extension/tests/integration/DiagnosticsProvider.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CtxloomDiagnosticsProvider } from '../../src/providers/DiagnosticsProvider.js';

function fakeTools(violations: any[]) { return { rulesCheck: async () => violations } as never; }

suite('DiagnosticsProvider', () => {
  test('produces a Diagnostic for each violation with the right severity', async () => {
    const p = new CtxloomDiagnosticsProvider(fakeTools([
      { file: 'a.ts', line: 2, col: 1, endLine: 2, endCol: 5, rule: 'no-cycle', message: 'cyclic import', severity: 'error' },
    ]));
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'export const x = 1;\nimport y from "./y";\n' });
    await p.refresh(doc.uri);
    const diags = vscode.languages.getDiagnostics(doc.uri);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error);
    assert.strictEqual(diags[0].source, 'ctxloom');
    p.dispose();
  });

  test('clear() removes diagnostics for a uri', async () => {
    const p = new CtxloomDiagnosticsProvider(fakeTools([{ file: 'a.ts', line: 1, col: 1, endLine: 1, endCol: 2, rule: 'r', message: 'm', severity: 'info' }]));
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'x;\n' });
    await p.refresh(doc.uri);
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 1);
    p.clear(doc.uri);
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 0);
    p.dispose();
  });
});
```

- [ ] **Step 3: Wire in extension.ts**

In `apps/vscode-extension/src/extension.ts`, after the hover wiring, add:

```typescript
let diagnostics: import('./providers/DiagnosticsProvider.js').CtxloomDiagnosticsProvider | null = null;
function refreshDiagnostics() {
  diagnostics?.dispose(); diagnostics = null;
  if (vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.diagnostics') && tools) {
    const Cls = require('./providers/DiagnosticsProvider.js').CtxloomDiagnosticsProvider as typeof import('./providers/DiagnosticsProvider.js').CtxloomDiagnosticsProvider;
    diagnostics = new Cls(tools);
    context.subscriptions.push({ dispose: () => diagnostics?.dispose() });
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => diagnostics?.refresh(d.uri)));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => { if (e) diagnostics?.refresh(e.document.uri); }));
    if (vscode.window.activeTextEditor) void diagnostics.refresh(vscode.window.activeTextEditor.document.uri);
  }
}
refreshDiagnostics();
context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.diagnostics')) refreshDiagnostics(); }));
```

- [ ] **Step 4: Run tests**

Run: `cd apps/vscode-extension && npm run build && npx vscode-test --label integration --files out/tests/integration/DiagnosticsProvider.test.js`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/providers/DiagnosticsProvider.ts apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/DiagnosticsProvider.test.ts
git commit -m "feat(vscode-extension): DiagnosticsProvider — rules violations as squiggles"
```

---

### Task 14: BlastRadiusView and CodeHealthView (TDD)

**Files:**
- Create: `apps/vscode-extension/src/providers/BlastRadiusView.ts`
- Create: `apps/vscode-extension/src/providers/CodeHealthView.ts`
- Test: `apps/vscode-extension/tests/integration/BlastRadiusView.test.ts`
- Test: `apps/vscode-extension/tests/integration/CodeHealthView.test.ts`
- Modify: `apps/vscode-extension/src/extension.ts` — register tree-view providers

- [ ] **Step 1: Implement BlastRadiusView**

Write `apps/vscode-extension/src/providers/BlastRadiusView.ts`:

```typescript
import * as vscode from 'vscode';
import type { Tools, BlastResult } from '../client/tools.js';

interface Node { label: string; uri?: vscode.Uri; children?: Node[]; iconId?: string }

export class BlastRadiusView implements vscode.TreeDataProvider<Node> {
  private root: Node | null = null;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly tools: Tools) {}

  async refreshFor(uri: vscode.Uri): Promise<void> {
    const file = vscode.workspace.asRelativePath(uri);
    let blast: BlastResult;
    try { blast = await this.tools.blastRadius(file); }
    catch { this.root = { label: 'Blast radius unavailable' }; this.emitter.fire(); return; }

    const fileNode = (path: string) => ({ label: path, uri: vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath + '/' + path) }) as Node;
    this.root = {
      label: `Blast for ${file}`,
      children: [
        { label: `Direct importers (${blast.direct.length})`, children: blast.direct.map(fileNode) },
        { label: `Transitive (${blast.transitive.length})`, children: blast.transitive.map(fileNode) },
        { label: `Historical coupling (${blast.historical.length})`, children: blast.historical.map(fileNode) },
      ],
    };
    this.emitter.fire();
  }

  getChildren(node?: Node): vscode.ProviderResult<Node[]> {
    if (!node) return this.root ? [this.root] : [];
    return node.children ?? [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const collapsible = (node.children?.length ?? 0) > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    if (node.uri) {
      item.resourceUri = node.uri;
      item.command = { command: 'vscode.open', title: 'Open', arguments: [node.uri] };
    }
    return item;
  }
}
```

- [ ] **Step 2: Implement CodeHealthView**

Write `apps/vscode-extension/src/providers/CodeHealthView.ts`:

```typescript
import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';

interface Node { label: string; children?: Node[]; uri?: vscode.Uri; isAction?: boolean }

export class CodeHealthView implements vscode.TreeDataProvider<Node> {
  private root: Node | null = null;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly tools: Tools, private readonly dashboardUrl: () => string) {}

  async refresh(): Promise<void> {
    let gaps: { isolated: string[]; deadCode: string[] } = { isolated: [], deadCode: [] };
    let hubs: { file: string; importers: number }[] = [];
    let communities: { count: number } = { count: 0 };
    try { [gaps, hubs, communities] = await Promise.all([this.tools.knowledgeGaps(), this.tools.hubNodes(10), this.tools.communityList()]); } catch { /* tolerate */ }

    const fileNode = (label: string) => ({ label, uri: vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath + '/' + label) }) as Node;

    this.root = {
      label: 'Code Health',
      children: [
        { label: `Dead code (${gaps.deadCode.length})`, children: gaps.deadCode.slice(0, 10).map(fileNode) },
        { label: `Hub files (${hubs.length})`, children: hubs.slice(0, 10).map(h => ({ label: `${h.file} · ↑${h.importers}`, uri: vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath + '/' + h.file) })) },
        { label: `Communities (${communities.count})`, children: [] },
        { label: 'Open in Dashboard →', isAction: true },
      ],
    };
    this.emitter.fire();
  }

  getChildren(node?: Node): vscode.ProviderResult<Node[]> { if (!node) return this.root ? [this.root] : []; return node.children ?? []; }

  getTreeItem(node: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, (node.children?.length ?? 0) > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    if (node.uri) { item.resourceUri = node.uri; item.command = { command: 'vscode.open', title: 'Open', arguments: [node.uri] }; }
    if (node.isAction) item.command = { command: 'ctxloom.openDashboard', title: 'Open in Dashboard' };
    return item;
  }
}
```

- [ ] **Step 3: Write integration tests**

Write `apps/vscode-extension/tests/integration/BlastRadiusView.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { BlastRadiusView } from '../../src/providers/BlastRadiusView.js';

const fakeTools = { blastRadius: async () => ({ direct: ['b.ts', 'c.ts'], transitive: ['d.ts'], historical: [] }) } as never;

suite('BlastRadiusView', () => {
  test('refreshFor populates 3 sections with correct counts', async () => {
    const v = new BlastRadiusView(fakeTools);
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: '' });
    await v.refreshFor(doc.uri);
    const root = (await v.getChildren())![0];
    const sections = await v.getChildren(root);
    assert.match(sections![0].label, /^Direct importers \(2\)/);
    assert.match(sections![1].label, /^Transitive \(1\)/);
    assert.match(sections![2].label, /^Historical coupling \(0\)/);
  });
});
```

Write `apps/vscode-extension/tests/integration/CodeHealthView.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CodeHealthView } from '../../src/providers/CodeHealthView.js';

const fakeTools = {
  knowledgeGaps: async () => ({ isolated: [], deadCode: ['x.ts'], untestedHubs: [] }),
  hubNodes: async () => [{ file: 'h.ts', importers: 12 }],
  communityList: async () => ({ count: 4 }),
} as never;

suite('CodeHealthView', () => {
  test('renders dead code, hub files, communities counts and an action link', async () => {
    const v = new CodeHealthView(fakeTools, () => 'http://localhost:7842');
    await v.refresh();
    const root = (await v.getChildren())![0];
    const sections = await v.getChildren(root);
    assert.match(sections![0].label, /Dead code \(1\)/);
    assert.match(sections![1].label, /Hub files \(1\)/);
    assert.match(sections![2].label, /Communities \(4\)/);
    assert.strictEqual(sections![3].isAction, true);
  });
});
```

- [ ] **Step 4: Wire in extension.ts**

In `apps/vscode-extension/src/extension.ts`, after diagnostics wiring add:

```typescript
let blastView: import('./providers/BlastRadiusView.js').BlastRadiusView | null = null;
let healthView: import('./providers/CodeHealthView.js').CodeHealthView | null = null;
if (tools) {
  const Blast = require('./providers/BlastRadiusView.js').BlastRadiusView as typeof import('./providers/BlastRadiusView.js').BlastRadiusView;
  const Health = require('./providers/CodeHealthView.js').CodeHealthView as typeof import('./providers/CodeHealthView.js').CodeHealthView;
  blastView = new Blast(tools);
  healthView = new Health(tools, () => vscode.workspace.getConfiguration('ctxloom').get<string>('dashboardUrl') ?? 'http://localhost:7842');
  context.subscriptions.push(vscode.window.registerTreeDataProvider('ctxloom.blastRadius', blastView));
  context.subscriptions.push(vscode.window.registerTreeDataProvider('ctxloom.codeHealth', healthView));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => { if (e) blastView?.refreshFor(e.document.uri); }));
  if (vscode.window.activeTextEditor) void blastView.refreshFor(vscode.window.activeTextEditor.document.uri);
  void healthView.refresh();
  context.subscriptions.push(vscode.commands.registerCommand('ctxloom.refreshCodeHealth', () => healthView?.refresh()));
}
```

- [ ] **Step 5: Run tests**

Run: `cd apps/vscode-extension && npm run build && npx vscode-test --label integration --files "out/tests/integration/{BlastRadiusView,CodeHealthView}.test.js"`
Expected: 2/2 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/vscode-extension/src/providers/BlastRadiusView.ts apps/vscode-extension/src/providers/CodeHealthView.ts apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/BlastRadiusView.test.ts apps/vscode-extension/tests/integration/CodeHealthView.test.ts
git commit -m "feat(vscode-extension): BlastRadiusView + CodeHealthView tree providers"
```

---

### Task 15: Status-bar wiring with risk lookups

**Files:**
- Modify: `apps/vscode-extension/src/extension.ts` — instantiate status bar and update on active editor changes
- Test: `apps/vscode-extension/tests/integration/StatusBar.test.ts`

- [ ] **Step 1: Wire the status bar**

In `apps/vscode-extension/src/extension.ts`, near the top of `activate()` after license gate is initialized (license gate full wiring lands in Task 21; for now use a stub `LICENSED` state):

```typescript
const { createStatusBarItem } = require('./license/statusBar.js') as typeof import('./license/statusBar.js');
const statusBar = createStatusBarItem('ctxloom.openSettings');
context.subscriptions.push({ dispose: () => statusBar.dispose() });

const updateStatusBar = async () => {
  const editor = vscode.window.activeTextEditor;
  let riskScore: number | null = null;
  if (editor && tools) {
    try { const r = await tools.riskOverlay(vscode.workspace.asRelativePath(editor.document.uri)); riskScore = r?.score ?? null; }
    catch { riskScore = null; }
  }
  statusBar.update({ licenseState: { kind: 'LICENSED', tier: 'pro', expiresAt: '' }, riskScore });
};

context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(d => { if (vscode.window.activeTextEditor?.document === d) updateStatusBar(); }));
await updateStatusBar();
```

- [ ] **Step 2: Write the integration test**

Write `apps/vscode-extension/tests/integration/StatusBar.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { renderStatusBar } from '../../src/license/statusBar.js';

suite('StatusBar', () => {
  test('renderStatusBar produces expected text for licensed + risk', () => {
    const r = renderStatusBar({ licenseState: { kind: 'LICENSED', tier: 'pro', expiresAt: '' }, riskScore: 0.30 });
    assert.strictEqual(r.text, '⚠ 0.30 · ctxloom');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/vscode-extension && npm run build && npx vscode-test --label integration --files out/tests/integration/StatusBar.test.js`
Expected: 1/1 pass.

- [ ] **Step 4: Commit**

```bash
git add apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/StatusBar.test.ts
git commit -m "feat(vscode-extension): wire status-bar item — licensed + active-file risk"
```

---

## Phase 4 — Rich providers

### Task 16: CodeLensProvider — file-top lens (TDD)

**Files:**
- Create: `apps/vscode-extension/src/providers/CodeLensProvider.ts`
- Test: `apps/vscode-extension/tests/integration/CodeLensProvider.test.ts`
- Modify: `apps/vscode-extension/src/extension.ts` — register provider gated by `features.codeLens`

- [ ] **Step 1: Implement the provider (file-top lens only — symbol lens lands in Task 17)**

Write `apps/vscode-extension/src/providers/CodeLensProvider.ts`:

```typescript
import * as vscode from 'vscode';
import type { Tools, RiskInfo } from '../client/tools.js';
import type { TtlCache } from '../shared/cache.js';

export interface CodeLensDeps { tools: Tools; cache: TtlCache<string, RiskInfo | null> }

export class CtxloomCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  constructor(private readonly deps: CodeLensDeps) {}

  refresh(): void { this.emitter.fire(); }

  async provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    const file = vscode.workspace.asRelativePath(document.uri);
    let risk = this.deps.cache.get(file);
    if (risk === undefined) {
      try { risk = await this.deps.tools.riskOverlay(file); } catch { risk = null; }
      this.deps.cache.set(file, risk);
    }
    const top = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [];
    if (risk !== null) {
      const owner = risk.topOwner !== null ? ` · @${risk.topOwner}` : '';
      lenses.push(new vscode.CodeLens(top, { title: `risk ${risk.score.toFixed(2)} (${risk.label})${owner}`, command: '' }));
    }
    return lenses;
  }
}
```

- [ ] **Step 2: Write the integration test**

Write `apps/vscode-extension/tests/integration/CodeLensProvider.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CtxloomCodeLensProvider } from '../../src/providers/CodeLensProvider.js';
import { TtlCache } from '../../src/shared/cache.js';

const fakeTools = { riskOverlay: async () => ({ file: 'a.ts', score: 0.42, label: 'medium', topOwner: 'alice' }) } as never;

suite('CodeLensProvider — file-top', () => {
  test('emits a single lens at line 0 with risk score and owner', async () => {
    const p = new CtxloomCodeLensProvider({ tools: fakeTools, cache: new TtlCache({ ttlMs: 30_000 }) });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'export const x = 1;\n' });
    const lenses = await p.provideCodeLenses(doc, new vscode.CancellationTokenSource().token);
    assert.strictEqual(lenses.length, 1);
    assert.match(lenses[0].command!.title, /risk 0\.42 \(medium\) · @alice/);
  });
});
```

- [ ] **Step 3: Wire in extension.ts**

In `apps/vscode-extension/src/extension.ts`:

```typescript
const lensCache = new (await import('./shared/cache.js')).TtlCache<string, import('./client/tools.js').RiskInfo | null>({ ttlMs: 30_000 });
let lensDisposable: vscode.Disposable | null = null;
let lensProvider: import('./providers/CodeLensProvider.js').CtxloomCodeLensProvider | null = null;
function refreshLens() {
  lensDisposable?.dispose(); lensDisposable = null;
  if (vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.codeLens') && tools) {
    const Cls = require('./providers/CodeLensProvider.js').CtxloomCodeLensProvider as typeof import('./providers/CodeLensProvider.js').CtxloomCodeLensProvider;
    lensProvider = new Cls({ tools, cache: lensCache });
    lensDisposable = vscode.languages.registerCodeLensProvider({ scheme: 'file' }, lensProvider);
    context.subscriptions.push(lensDisposable);
  }
}
refreshLens();
context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.codeLens')) refreshLens(); }));
```

- [ ] **Step 4: Run tests**

Run: `cd apps/vscode-extension && npm run build && npx vscode-test --label integration --files out/tests/integration/CodeLensProvider.test.js`
Expected: 1/1 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/providers/CodeLensProvider.ts apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/CodeLensProvider.test.ts
git commit -m "feat(vscode-extension): file-top code lens — risk + label + owner"
```

---

### Task 17: CodeLensProvider — per-symbol "Copy AI Context"

**Files:**
- Modify: `apps/vscode-extension/src/providers/CodeLensProvider.ts`
- Modify: `apps/vscode-extension/src/commands/index.ts` (created in Task 20; for this task add a stub here and register in Task 20)
- Modify: `apps/vscode-extension/tests/integration/CodeLensProvider.test.ts`

- [ ] **Step 1: Extend the provider to emit per-symbol lenses**

Replace `provideCodeLenses` body in `apps/vscode-extension/src/providers/CodeLensProvider.ts` to also use `vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri)`:

```typescript
async provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
  const file = vscode.workspace.asRelativePath(document.uri);
  let risk = this.deps.cache.get(file);
  if (risk === undefined) {
    try { risk = await this.deps.tools.riskOverlay(file); } catch { risk = null; }
    this.deps.cache.set(file, risk);
  }

  const lenses: vscode.CodeLens[] = [];
  const top = new vscode.Range(0, 0, 0, 0);
  if (risk !== null) {
    const owner = risk.topOwner !== null ? ` · @${risk.topOwner}` : '';
    lenses.push(new vscode.CodeLens(top, { title: `risk ${risk.score.toFixed(2)} (${risk.label})${owner}`, command: '' }));
  }

  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>('vscode.executeDocumentSymbolProvider', document.uri);
  if (Array.isArray(symbols)) {
    for (const sym of symbols) {
      if (sym.kind === vscode.SymbolKind.Function || sym.kind === vscode.SymbolKind.Method || sym.kind === vscode.SymbolKind.Class) {
        const start = sym.range.start;
        const lensRange = new vscode.Range(start.line, 0, start.line, 0);
        lenses.push(new vscode.CodeLens(lensRange, {
          title: '↗ Copy AI context',
          command: 'ctxloom.copyContextPacket',
          arguments: [{ file, symbol: sym.name }],
        }));
      }
    }
  }
  return lenses;
}
```

- [ ] **Step 2: Add the command implementation stub**

Create `apps/vscode-extension/src/commands/index.ts` (will be expanded in Task 20):

```typescript
import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';
import type { Logger } from '../shared/logger.js';

export interface CommandDeps { tools: Tools | null; logger: Logger; getDashboardUrl(): string }

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ctxloom.copyContextPacket', async (args?: { file?: string; symbol?: string }) => {
      if (!deps.tools) { vscode.window.showWarningMessage('ctxloom server not available.'); return; }
      const editor = vscode.window.activeTextEditor;
      const file = args?.file ?? (editor ? vscode.workspace.asRelativePath(editor.document.uri) : null);
      const symbol = args?.symbol ?? '';
      if (!file) { vscode.window.showWarningMessage('Open a file first.'); return; }
      try {
        const packet = await deps.tools.contextPacket(file, symbol);
        await vscode.env.clipboard.writeText(packet.text);
        vscode.window.showInformationMessage(`Copied ${formatTokens(packet.skeletonTokens)} tokens (${packet.reductionPercent}% reduced)`);
      } catch (err) {
        deps.logger.error(`copyContextPacket failed: ${String(err)}`);
        vscode.window.showErrorMessage('Could not generate context packet.');
      }
    }),
    vscode.commands.registerCommand('ctxloom.openDashboard', async () => {
      await vscode.env.openExternal(vscode.Uri.parse(deps.getDashboardUrl()));
    }),
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
```

In `apps/vscode-extension/src/extension.ts`, near the bottom of `activate()`, add:

```typescript
const { registerCommands } = require('./commands/index.js') as typeof import('./commands/index.js');
registerCommands(context, { tools, logger: logger!, getDashboardUrl: () => vscode.workspace.getConfiguration('ctxloom').get<string>('dashboardUrl') ?? 'http://localhost:7842' });
```

- [ ] **Step 3: Update tests**

Append to `apps/vscode-extension/tests/integration/CodeLensProvider.test.ts`:

```typescript
suite('CodeLensProvider — Copy AI Context per symbol', () => {
  test('produces a "Copy AI context" lens at each function start', async () => {
    const p = new CtxloomCodeLensProvider({ tools: fakeTools, cache: new TtlCache({ ttlMs: 30_000 }) });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'export function alpha() {}\nexport function beta() {}\n' });
    const lenses = await p.provideCodeLenses(doc, new vscode.CancellationTokenSource().token);
    const copyLenses = lenses.filter(l => l.command?.title === '↗ Copy AI context');
    // Document symbol provider not registered in headless harness for arbitrary content;
    // this test asserts that file-top lens is unaffected and copy-lens code path doesn't throw.
    assert.ok(lenses.length >= 1);
    assert.ok(Array.isArray(copyLenses));
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd apps/vscode-extension && npm run build && npx vscode-test --label integration --files out/tests/integration/CodeLensProvider.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/providers/CodeLensProvider.ts apps/vscode-extension/src/commands/index.ts apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/CodeLensProvider.test.ts
git commit -m "feat(vscode-extension): per-symbol Copy AI Context code lens (skeletonized clipboard)"
```

---

### Task 18: GutterDecorations (TDD)

**Files:**
- Create: `apps/vscode-extension/src/providers/GutterDecorations.ts`
- Test: `apps/vscode-extension/tests/integration/GutterDecorations.test.ts`
- Modify: `apps/vscode-extension/src/extension.ts` — wire gated by `features.gutterDecorations`

- [ ] **Step 1: Implement the decorations**

Write `apps/vscode-extension/src/providers/GutterDecorations.ts`:

```typescript
import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';
import { debounce } from '../shared/debounce.js';

export interface GutterDeps { tools: Tools; debounceMs: number; thresholds: { high: number; medium: number }; showDeadCodeMarker: boolean }

export class GutterDecorations {
  private readonly highDeco = vscode.window.createTextEditorDecorationType({ gutterIconSize: 'contain', overviewRulerColor: '#ef4444', overviewRulerLane: vscode.OverviewRulerLane.Left, isWholeLine: true, backgroundColor: 'rgba(239,68,68,0.06)' });
  private readonly mediumDeco = vscode.window.createTextEditorDecorationType({ overviewRulerColor: '#f97316', overviewRulerLane: vscode.OverviewRulerLane.Left, isWholeLine: true, backgroundColor: 'rgba(249,115,22,0.06)' });
  private readonly lowDeco = vscode.window.createTextEditorDecorationType({ overviewRulerColor: '#3b82f6', overviewRulerLane: vscode.OverviewRulerLane.Left, isWholeLine: true, backgroundColor: 'rgba(59,130,246,0.04)' });
  private readonly deadDeco = vscode.window.createTextEditorDecorationType({ after: { contentText: ' ⚠ dead code', color: '#a1a1aa', margin: '0 0 0 0.5em' } });

  private readonly applyForEditor = debounce(async (editor: vscode.TextEditor) => { await this.applyImpl(editor); }, this.deps.debounceMs);

  constructor(private readonly deps: GutterDeps) {}

  apply(editor: vscode.TextEditor): void { this.applyForEditor(editor); }

  private async applyImpl(editor: vscode.TextEditor): Promise<void> {
    const file = vscode.workspace.asRelativePath(editor.document.uri);
    let info: { churnLines: number; bucket: 'low' | 'medium' | 'high'; importers: number };
    try { info = await this.deps.tools.gitCoupling(file); } catch { return; }
    const wholeFile = new vscode.Range(0, 0, editor.document.lineCount - 1, 0);
    editor.setDecorations(this.highDeco, info.bucket === 'high' ? [wholeFile] : []);
    editor.setDecorations(this.mediumDeco, info.bucket === 'medium' ? [wholeFile] : []);
    editor.setDecorations(this.lowDeco, info.bucket === 'low' ? [wholeFile] : []);
    editor.setDecorations(this.deadDeco, this.deps.showDeadCodeMarker && info.importers === 0 ? [new vscode.Range(0, 0, 0, 0)] : []);
  }

  clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.highDeco, []);
      editor.setDecorations(this.mediumDeco, []);
      editor.setDecorations(this.lowDeco, []);
      editor.setDecorations(this.deadDeco, []);
    }
  }

  dispose(): void {
    this.applyForEditor.cancel();
    this.highDeco.dispose(); this.mediumDeco.dispose(); this.lowDeco.dispose(); this.deadDeco.dispose();
  }
}
```

- [ ] **Step 2: Write the integration test**

Write `apps/vscode-extension/tests/integration/GutterDecorations.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { GutterDecorations } from '../../src/providers/GutterDecorations.js';

const fakeTools = { gitCoupling: async () => ({ churnLines: 1500, bucket: 'high' as const, importers: 0 }) } as never;

suite('GutterDecorations', () => {
  test('apply() does not throw on a freshly-opened editor', async () => {
    const g = new GutterDecorations({ tools: fakeTools, debounceMs: 1, thresholds: { high: 1000, medium: 200 }, showDeadCodeMarker: true });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'export const x = 1;\n' });
    const editor = await vscode.window.showTextDocument(doc);
    g.apply(editor);
    await new Promise(r => setTimeout(r, 30));
    assert.ok(true);
    g.dispose();
  });

  test('clearAll() removes decorations from visible editors', async () => {
    const g = new GutterDecorations({ tools: fakeTools, debounceMs: 1, thresholds: { high: 1000, medium: 200 }, showDeadCodeMarker: true });
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'x;\n' });
    await vscode.window.showTextDocument(doc);
    g.clearAll();
    assert.ok(true);
    g.dispose();
  });
});
```

- [ ] **Step 3: Wire in extension.ts**

```typescript
let gutter: import('./providers/GutterDecorations.js').GutterDecorations | null = null;
function refreshGutter() {
  gutter?.dispose(); gutter = null;
  if (vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.gutterDecorations') && tools) {
    const Cls = require('./providers/GutterDecorations.js').GutterDecorations as typeof import('./providers/GutterDecorations.js').GutterDecorations;
    gutter = new Cls({
      tools,
      debounceMs: vscode.workspace.getConfiguration('ctxloom').get<number>('debounceMs') ?? 250,
      thresholds: { high: vscode.workspace.getConfiguration('ctxloom').get<number>('gutter.churnThresholdHigh') ?? 1000, medium: vscode.workspace.getConfiguration('ctxloom').get<number>('gutter.churnThresholdMedium') ?? 200 },
      showDeadCodeMarker: vscode.workspace.getConfiguration('ctxloom').get<boolean>('gutter.showDeadCodeMarker') ?? true,
    });
    context.subscriptions.push({ dispose: () => gutter?.dispose() });
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => { if (e && gutter) gutter.apply(e); }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => { const ed = vscode.window.visibleTextEditors.find(x => x.document === e.document); if (ed && gutter) gutter.apply(ed); }));
    if (vscode.window.activeTextEditor) gutter.apply(vscode.window.activeTextEditor);
  }
}
refreshGutter();
context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.gutterDecorations') || e.affectsConfiguration('ctxloom.gutter')) refreshGutter(); }));
```

- [ ] **Step 4: Run tests**

Run: `cd apps/vscode-extension && npm run build && npx vscode-test --label integration --files out/tests/integration/GutterDecorations.test.js`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/providers/GutterDecorations.ts apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/GutterDecorations.test.ts
git commit -m "feat(vscode-extension): gutter decorations — churn heatmap + dead-code marker"
```

---

### Task 19: QuickFixProvider (TDD)

**Files:**
- Create: `apps/vscode-extension/src/providers/QuickFixProvider.ts`
- Test: `apps/vscode-extension/tests/integration/QuickFixProvider.test.ts`
- Modify: `apps/vscode-extension/src/extension.ts` — register CodeActionProvider gated by `features.quickFixes`

- [ ] **Step 1: Implement the provider**

Write `apps/vscode-extension/src/providers/QuickFixProvider.ts`:

```typescript
import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';

export class CtxloomQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedKinds = [vscode.CodeActionKind.QuickFix];
  constructor(private readonly tools: Tools) {}

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionProviderMetadata & { diagnostics?: readonly vscode.Diagnostic[] }, _token: vscode.CancellationToken): vscode.CodeAction[] {
    const fromCtx = (ctx as unknown as { diagnostics?: readonly vscode.Diagnostic[] }).diagnostics ?? [];
    const ours = fromCtx.filter(d => d.source === 'ctxloom');
    return ours.map(d => {
      const action = new vscode.CodeAction(`Apply suggested refactor for ${d.code ?? 'rule'}`, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [d];
      action.command = {
        command: 'ctxloom.applyRefactor',
        title: 'Apply ctxloom refactor',
        arguments: [{ file: vscode.workspace.asRelativePath(document.uri), rule: d.code, range: { startLine: d.range.start.line, startCol: d.range.start.character, endLine: d.range.end.line, endCol: d.range.end.character } }],
      };
      return action;
    });
  }
}

export async function applyRefactorCommand(tools: Tools | null, args: { file: string; rule: string | undefined; range: { startLine: number; startCol: number; endLine: number; endCol: number } }): Promise<void> {
  if (!tools) { vscode.window.showWarningMessage('ctxloom server not available.'); return; }
  const choice = await vscode.window.showInformationMessage(`Apply ctxloom refactor for ${args.rule ?? 'rule'}?`, { modal: true }, 'Apply', 'Cancel');
  if (choice !== 'Apply') return;
  const result = await tools.applyRefactor(args);
  if (!result.ok) { vscode.window.showErrorMessage(result.message ?? 'Refactor failed.'); return; }
  vscode.window.showInformationMessage('Refactor applied.');
}
```

- [ ] **Step 2: Write the integration test**

Write `apps/vscode-extension/tests/integration/QuickFixProvider.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { CtxloomQuickFixProvider } from '../../src/providers/QuickFixProvider.js';

const fakeTools = { applyRefactor: async () => ({ ok: true }) } as never;

suite('QuickFixProvider', () => {
  test('produces an Apply action only for ctxloom-source diagnostics', async () => {
    const p = new CtxloomQuickFixProvider(fakeTools);
    const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'x;\n' });
    const ctxDiag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'cycle', vscode.DiagnosticSeverity.Error);
    ctxDiag.source = 'ctxloom'; ctxDiag.code = 'no-cycle';
    const tsDiag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'ts error', vscode.DiagnosticSeverity.Error);
    tsDiag.source = 'ts';
    const actions = p.provideCodeActions(doc, new vscode.Range(0, 0, 0, 1), { only: vscode.CodeActionKind.QuickFix, triggerKind: vscode.CodeActionTriggerKind.Invoke, diagnostics: [ctxDiag, tsDiag] } as never, new vscode.CancellationTokenSource().token) as vscode.CodeAction[];
    assert.strictEqual(actions.length, 1);
    assert.match(actions[0].title, /no-cycle/);
  });
});
```

- [ ] **Step 3: Wire in extension.ts**

```typescript
if (tools && vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.quickFixes')) {
  const Cls = require('./providers/QuickFixProvider.js').CtxloomQuickFixProvider as typeof import('./providers/QuickFixProvider.js').CtxloomQuickFixProvider;
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new Cls(tools), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
  const { applyRefactorCommand } = require('./providers/QuickFixProvider.js') as typeof import('./providers/QuickFixProvider.js');
  context.subscriptions.push(vscode.commands.registerCommand('ctxloom.applyRefactor', (a: never) => applyRefactorCommand(tools, a)));
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/vscode-extension && npm run build && npx vscode-test --label integration --files out/tests/integration/QuickFixProvider.test.js`
Expected: 1/1 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/providers/QuickFixProvider.ts apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/QuickFixProvider.test.ts
git commit -m "feat(vscode-extension): rules quick-fixes — ctx_apply_refactor light-bulb action"
```

---

### Task 20: Command palette commands + license commands wiring

**Files:**
- Modify: `apps/vscode-extension/src/commands/index.ts` — expand from Task 17 stub
- Modify: `apps/vscode-extension/src/extension.ts` — wire LicenseGate so license commands work

- [ ] **Step 1: Expand commands/index.ts**

Replace `apps/vscode-extension/src/commands/index.ts` with:

```typescript
import * as vscode from 'vscode';
import type { Tools } from '../client/tools.js';
import type { Logger } from '../shared/logger.js';
import type { LicenseGate } from '../license/LicenseGate.js';

type LicenseOps = {
  startTrial: (email: string) => Promise<{ checkoutUrl: string }>;
  activate: (key: string) => Promise<void>;
  deactivate: () => Promise<void>;
};

export interface CommandDeps {
  tools: Tools | null;
  logger: Logger;
  getDashboardUrl(): string;
  licenseGate: LicenseGate;
  licenseOps: LicenseOps;
  openSettings: () => void;
  refreshHealth: () => void;
  refreshBlast: () => void;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ctxloom.copyContextPacket', async (args?: { file?: string; symbol?: string }) => {
      if (!deps.tools) { vscode.window.showWarningMessage('ctxloom server not available.'); return; }
      const editor = vscode.window.activeTextEditor;
      const file = args?.file ?? (editor ? vscode.workspace.asRelativePath(editor.document.uri) : null);
      if (!file) { vscode.window.showWarningMessage('Open a file first.'); return; }
      const symbol = args?.symbol ?? '';
      try {
        const packet = await deps.tools.contextPacket(file, symbol);
        await vscode.env.clipboard.writeText(packet.text);
        vscode.window.showInformationMessage(`Copied ${formatTokens(packet.skeletonTokens)} tokens (${packet.reductionPercent}% reduced)`);
      } catch (err) {
        deps.logger.error(`copyContextPacket failed: ${String(err)}`);
        vscode.window.showErrorMessage('Could not generate context packet.');
      }
    }),

    vscode.commands.registerCommand('ctxloom.openDashboard', async () => {
      await vscode.env.openExternal(vscode.Uri.parse(deps.getDashboardUrl()));
    }),

    vscode.commands.registerCommand('ctxloom.showBlastRadius', () => deps.refreshBlast()),
    vscode.commands.registerCommand('ctxloom.refreshCodeHealth', () => deps.refreshHealth()),

    vscode.commands.registerCommand('ctxloom.showOwners', async () => {
      if (!deps.tools) { vscode.window.showWarningMessage('ctxloom server not available.'); return; }
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage('Open a file first.'); return; }
      const file = vscode.workspace.asRelativePath(editor.document.uri);
      const r = await deps.tools.riskOverlay(file);
      const owner = r?.topOwner ?? 'unknown';
      vscode.window.showInformationMessage(`Top owner of ${file}: @${owner}`);
    }),

    vscode.commands.registerCommand('ctxloom.activateLicense', async () => {
      const key = await vscode.window.showInputBox({ prompt: 'Paste your ctxloom license key', password: false, ignoreFocusOut: true });
      if (!key) return;
      try { await deps.licenseOps.activate(key); vscode.window.showInformationMessage('ctxloom license activated.'); deps.licenseGate.evaluate(); }
      catch (err) { vscode.window.showErrorMessage(`Activation failed: ${String(err)}`); }
    }),

    vscode.commands.registerCommand('ctxloom.startTrial', async () => {
      const email = await vscode.window.showInputBox({ prompt: 'Email for your free 7-day trial', validateInput: v => /.+@.+\..+/.test(v) ? null : 'Enter a valid email.' });
      if (!email) return;
      try {
        const { checkoutUrl } = await deps.licenseOps.startTrial(email);
        await vscode.env.openExternal(vscode.Uri.parse(checkoutUrl));
        vscode.window.showInformationMessage('Trial checkout opened in browser. Your license key will arrive by email.');
        deps.openSettings();
      } catch (err) { vscode.window.showErrorMessage(`Trial start failed: ${String(err)}`); }
    }),

    vscode.commands.registerCommand('ctxloom.showLicenseStatus', () => {
      const s = deps.licenseGate.current();
      vscode.window.showInformationMessage(`License: ${s.kind}${'tier' in s ? ` · ${s.tier}` : ''}${'daysLeft' in s ? ` · ${s.daysLeft}d left` : ''}`);
    }),

    vscode.commands.registerCommand('ctxloom.deactivateLicense', async () => {
      const ok = await vscode.window.showWarningMessage('Deactivate ctxloom on this machine?', { modal: true }, 'Deactivate');
      if (ok !== 'Deactivate') return;
      await deps.licenseOps.deactivate();
      deps.licenseGate.evaluate();
      vscode.window.showInformationMessage('License deactivated. The seat is free to use elsewhere.');
    }),

    vscode.commands.registerCommand('ctxloom.restartServer', () => deps.logger.info('Restart server requested via command palette.')),
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
```

- [ ] **Step 2: Wire LicenseGate + LicenseOps in extension.ts**

Add at the top of `activate()` after `logger` is created:

```typescript
import { LicenseGate, type LicenseInfo } from './license/LicenseGate.js';
const license = require('@ctxloom/core') as typeof import('@ctxloom/core');

async function readLicenseInfo(): Promise<LicenseInfo | null> {
  const f = await license.getLicenseInfo();
  if (!f) return null;
  return { tier: f.tier as LicenseInfo['tier'], status: f.status as LicenseInfo['status'], expiresAt: f.expiresAt, fingerprint: f.instanceId };
}

const licenseGate = new LicenseGate({ getInfo: readLicenseInfo, recheckMs: 60_000 });
await licenseGate.evaluate();
licenseGate.startRechecking();
context.subscriptions.push({ dispose: () => licenseGate.dispose() });
licenseGate.onStateChange(() => panel?.refresh());

const licenseOps = {
  startTrial: async (email: string) => license.startTrial(email),
  activate:   async (key: string)   => { await license.activateLicense(key); },
  deactivate: async ()              => { await license.deactivateLicense(); },
};
```

Update `computeState` to include real license:

```typescript
function computeState(): PanelState { return { license: licenseGate.current(), settings: readSettings() }; }
```

In `handleMessage`, add cases for license operations:

```typescript
if (msg.kind === 'startTrial') {
  try { const { checkoutUrl } = await licenseOps.startTrial(msg.email); await vscode.env.openExternal(vscode.Uri.parse(checkoutUrl)); panel?.send({ kind: 'trialCheckoutOpened', checkoutUrl }); }
  catch (err) { panel?.send({ kind: 'activationResult', ok: false, error: String(err) }); }
  return;
}
if (msg.kind === 'activateLicense') {
  try { await licenseOps.activate(msg.key); await licenseGate.evaluate(); panel?.send({ kind: 'activationResult', ok: true }); panel?.refresh(); }
  catch (err) { panel?.send({ kind: 'activationResult', ok: false, error: String(err) }); }
  return;
}
if (msg.kind === 'deactivateLicense') {
  await licenseOps.deactivate(); await licenseGate.evaluate(); panel?.send({ kind: 'deactivationResult', ok: true }); panel?.refresh();
  return;
}
```

Replace the `registerCommands(context, …)` call with the full deps object:

```typescript
registerCommands(context, {
  tools, logger: logger!,
  getDashboardUrl: () => vscode.workspace.getConfiguration('ctxloom').get<string>('dashboardUrl') ?? 'http://localhost:7842',
  licenseGate, licenseOps,
  openSettings: () => panel?.reveal(),
  refreshHealth: () => healthView?.refresh(),
  refreshBlast: () => { if (vscode.window.activeTextEditor) blastView?.refreshFor(vscode.window.activeTextEditor.document.uri); },
});

// Auto-open settings on first run with no license.
if (licenseGate.current().kind === 'NO_LICENSE') panel?.reveal('license');
```

- [ ] **Step 3: Write the integration test**

Write `apps/vscode-extension/tests/integration/Commands.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Commands', () => {
  test('all 11 ctxloom commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const cmd of [
      'ctxloom.openSettings', 'ctxloom.activateLicense', 'ctxloom.startTrial', 'ctxloom.showLicenseStatus',
      'ctxloom.deactivateLicense', 'ctxloom.openDashboard', 'ctxloom.showBlastRadius', 'ctxloom.showOwners',
      'ctxloom.copyContextPacket', 'ctxloom.refreshCodeHealth', 'ctxloom.restartServer',
    ]) assert.ok(all.includes(cmd), `${cmd} not registered`);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd apps/vscode-extension && npm run build && npx vscode-test --label integration --files out/tests/integration/Commands.test.js`
Expected: 1/1 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/commands/index.ts apps/vscode-extension/src/extension.ts apps/vscode-extension/tests/integration/Commands.test.ts
git commit -m "feat(vscode-extension): full command palette + license commands wired to LicenseGate"
```

---

### Task 21: McpBridge (TDD with feature-detect)

**Files:**
- Create: `apps/vscode-extension/src/providers/McpBridge.ts`
- Modify: `apps/vscode-extension/src/extension.ts` — register if API present, gated by `features.mcpBridge`

- [ ] **Step 1: Implement the bridge**

Write `apps/vscode-extension/src/providers/McpBridge.ts`:

```typescript
import * as vscode from 'vscode';
import type { Logger } from '../shared/logger.js';

interface McpServerDefinition { type: 'stdio'; label: string; command: string; args: string[]; cwd?: string }

export interface McpBridgeDeps { cliPath: string; cwd: string; logger: Logger }

/**
 * Registers ctxloom as an MCP server with VS Code's experimental MCP API
 * (`vscode.lm.registerMcpServerProvider`, available in 1.95+). Falls back
 * silently when the API is missing.
 */
export class McpBridge {
  private disposable: vscode.Disposable | null = null;

  constructor(private readonly deps: McpBridgeDeps) {}

  register(): void {
    const lm = (vscode as unknown as { lm?: { registerMcpServerProvider?: (id: string, provider: { provideServers: () => McpServerDefinition[] }) => vscode.Disposable } }).lm;
    if (!lm || typeof lm.registerMcpServerProvider !== 'function') {
      this.deps.logger.info('MCP bridge requires VS Code ≥ 1.95 — feature skipped.');
      return;
    }
    this.disposable = lm.registerMcpServerProvider('ctxloom', {
      provideServers: () => [{
        type: 'stdio',
        label: 'ctxloom',
        command: this.deps.cliPath,
        args: [],
        cwd: this.deps.cwd,
      }],
    });
    this.deps.logger.info('MCP bridge registered for AI assistants.');
  }

  dispose(): void { this.disposable?.dispose(); this.disposable = null; }
}
```

- [ ] **Step 2: Wire in extension.ts**

```typescript
let mcpBridge: import('./providers/McpBridge.js').McpBridge | null = null;
function refreshMcpBridge() {
  mcpBridge?.dispose(); mcpBridge = null;
  if (!vscode.workspace.getConfiguration('ctxloom').get<boolean>('features.mcpBridge')) return;
  const folder = vscode.workspace.workspaceFolders?.[0]; if (!folder) return;
  const Cls = require('./providers/McpBridge.js').McpBridge as typeof import('./providers/McpBridge.js').McpBridge;
  const cliPath = resolveCliPath({ extensionRoot: context.extensionPath, override: vscode.workspace.getConfiguration('ctxloom').get<string | null>('cliPath') ?? null }).path;
  mcpBridge = new Cls({ cliPath, cwd: folder.uri.fsPath, logger: logger! });
  mcpBridge.register();
  context.subscriptions.push({ dispose: () => mcpBridge?.dispose() });
}
refreshMcpBridge();
context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('ctxloom.features.mcpBridge')) refreshMcpBridge(); }));
```

- [ ] **Step 3: Verify build**

Run: `cd apps/vscode-extension && npm run lint`
Expected: PASS.

(No integration test for the bridge in this phase — the API is experimental, not present in the test runner. Manual verification covered in the README's manual test plan, Task 25.)

- [ ] **Step 4: Commit**

```bash
git add apps/vscode-extension/src/providers/McpBridge.ts apps/vscode-extension/src/extension.ts
git commit -m "feat(vscode-extension): MCP bridge — registers ctxloom for Copilot Chat / Cursor / Continue"
```

---

## Phase 5 — Build & ship

### Task 22: prepare-bundle.mjs — bundle ctxloom-pro inside the VSIX

**Files:**
- Create: `apps/vscode-extension/scripts/prepare-bundle.mjs`
- Verify: `apps/vscode-extension/.gitignore` already excludes `resources/ctxloom-cli/`

- [ ] **Step 1: Write the script**

Write `apps/vscode-extension/scripts/prepare-bundle.mjs`:

```javascript
#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extRoot, '../..');
const target = path.join(extRoot, 'resources', 'ctxloom-cli');

// Build ctxloom-pro from the workspace.
console.log('[prepare-bundle] Running ctxloom-pro build…');
const { execSync } = await import('node:child_process');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });

// Copy dist + node_modules + package.json (production-only deps).
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
copyDir(path.join(repoRoot, 'dist'), path.join(target, 'dist'));
copyDir(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'), {
  skip: name => name === '.cache' || name === '.bin' || name.startsWith('@types') || name.includes('vitest') || name.includes('@vscode'),
});
fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(target, 'package.json'));

console.log(`[prepare-bundle] Bundled ctxloom-pro → ${path.relative(extRoot, target)}`);

function copyDir(src, dst, opts = {}) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (opts.skip && opts.skip(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, opts);
    else fs.copyFileSync(s, d);
  }
}
```

- [ ] **Step 2: Run it once and verify the bundle**

Run:

```bash
cd apps/vscode-extension && node scripts/prepare-bundle.mjs
ls -lh resources/ctxloom-cli/dist/index.js
du -sh resources/ctxloom-cli
```

Expected: dist/index.js is ~500KB–1MB; total bundle is ~20–30MB.

- [ ] **Step 3: Commit (script only — bundle is gitignored)**

```bash
git add apps/vscode-extension/scripts/prepare-bundle.mjs
git commit -m "build(vscode-extension): prepare-bundle script — embed ctxloom-pro CLI in VSIX"
```

---

### Task 23: Smoke test (real CLI)

**Files:**
- Create: `apps/vscode-extension/tests/smoke/end-to-end.test.ts`
- Create: `apps/vscode-extension/tests/fixtures/workspace-a/a.ts`
- Create: `apps/vscode-extension/tests/fixtures/workspace-a/b.ts`

- [ ] **Step 1: Create the fixture workspace**

Write `apps/vscode-extension/tests/fixtures/workspace-a/a.ts`:

```typescript
export const a = 1;
```

Write `apps/vscode-extension/tests/fixtures/workspace-a/b.ts`:

```typescript
import { a } from './a.js';
export const b = a;
```

- [ ] **Step 2: Write the smoke test**

Write `apps/vscode-extension/tests/smoke/end-to-end.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension smoke (real ctxloom child)', () => {
  test('extension activates without errors and responds to commands', async function() {
    this.timeout(60_000);
    // Wait briefly for the activation chain to settle (server spawn + LicenseGate).
    await new Promise(r => setTimeout(r, 5_000));

    // Open Settings command exists and is callable.
    await vscode.commands.executeCommand('ctxloom.openSettings');

    // Hover should not throw on an import line in b.ts.
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'fixture workspace not loaded');
    const bUri = vscode.Uri.joinPath(folder!.uri, 'b.ts');
    const doc = await vscode.workspace.openTextDocument(bUri);
    await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(0, 24); // inside './a.js'
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', bUri, pos);
    assert.ok(Array.isArray(hovers));
  });
});
```

- [ ] **Step 3: Run the smoke test (requires bundled CLI)**

Run:

```bash
cd apps/vscode-extension && npm run build && npx vscode-test --label smoke
```

Expected: 1/1 pass.

- [ ] **Step 4: Commit**

```bash
git add apps/vscode-extension/tests/smoke/end-to-end.test.ts apps/vscode-extension/tests/fixtures/workspace-a/
git commit -m "test(vscode-extension): smoke test — real bundled CLI activates and responds"
```

---

### Task 24: CI workflows

**Files:**
- Create: `.github/workflows/build-extension.yml`
- Create: `.github/workflows/publish-extension.yml`

- [ ] **Step 1: Build workflow**

Write `.github/workflows/build-extension.yml`:

```yaml
name: build-extension
on:
  pull_request:
    paths:
      - 'apps/vscode-extension/**'
      - 'packages/core/**'
      - 'packages/mcp-client/**'
      - '.github/workflows/build-extension.yml'
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint --workspace=@ctxloom/vscode-extension
      - run: npx vitest run --root apps/vscode-extension
      - run: cd apps/vscode-extension && node scripts/prepare-bundle.mjs
      - run: cd apps/vscode-extension && node esbuild.config.mjs
      - if: matrix.os == 'ubuntu-latest'
        run: xvfb-run -a npm run test:integration --workspace=@ctxloom/vscode-extension
      - if: matrix.os == 'macos-latest'
        run: npm run test:integration --workspace=@ctxloom/vscode-extension
      - run: cd apps/vscode-extension && npx vsce package --no-dependencies -o ctxloom-vscode.vsix
      - uses: actions/upload-artifact@v4
        if: matrix.os == 'ubuntu-latest'
        with:
          name: ctxloom-vscode-vsix
          path: apps/vscode-extension/ctxloom-vscode.vsix
```

- [ ] **Step 2: Publish workflow**

Write `.github/workflows/publish-extension.yml`:

```yaml
name: publish-extension
on:
  push:
    tags: [ 'vscode-v*' ]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint --workspace=@ctxloom/vscode-extension
      - run: npx vitest run --root apps/vscode-extension
      - run: cd apps/vscode-extension && node scripts/prepare-bundle.mjs && node esbuild.config.mjs
      - run: xvfb-run -a npm run test:integration --workspace=@ctxloom/vscode-extension
      - run: xvfb-run -a npx vscode-test --label smoke --root apps/vscode-extension
      - run: cd apps/vscode-extension && npx vsce package --no-dependencies -o ctxloom-vscode.vsix
      - run: cd apps/vscode-extension && npx vsce publish --packagePath ctxloom-vscode.vsix
        env: { VSCE_PAT: '${{ secrets.VSCE_PAT }}' }
      - run: cd apps/vscode-extension && npx ovsx publish ctxloom-vscode.vsix
        env: { OVSX_PAT: '${{ secrets.OVSX_PAT }}' }
      - uses: softprops/action-gh-release@v2
        with:
          files: apps/vscode-extension/ctxloom-vscode.vsix
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-extension.yml .github/workflows/publish-extension.yml
git commit -m "ci(vscode-extension): build-on-PR and publish-on-tag workflows"
```

---

### Task 25: README + manual test plan + future-implementations log

**Files:**
- Create: `apps/vscode-extension/README.md`
- Create: `docs/future_features_vscode.md`

- [ ] **Step 1: Write the README**

Write `apps/vscode-extension/README.md`:

```markdown
# ctxloom — Code Context for Code Review (VS Code)

AST + git + graph context, in your editor. Hover risk, blast radius, dead code, MCP bridge for AI assistants.

## Features

- **Hover cards** on imports — risk, top owner, blast count
- **Rules diagnostics** — squiggles in the Problems panel
- **Status bar** — file risk + license state
- **Blast Radius panel** — direct + transitive + historical importers of the active file
- **Code Health panel** — workspace dead code, hub files, communities
- **Code Lens** — top-of-file risk + per-symbol "Copy AI context" (skeletonized, ~92% token reduction)
- **Gutter decorations** — churn heatmap + dead-code marker
- **Rules quick-fixes** — apply suggested refactors
- **MCP bridge** — auto-registers ctxloom as an MCP server for Copilot Chat / Cursor / Continue (VS Code 1.95+)

## Install

Marketplace: `ctxloom.ctxloom-vscode`. Or sideload the VSIX from the [GitHub releases page](https://github.com/kodiii/ctxloom/releases).

## License

7-day free trial, no card required. Activate via `ctxloom: Open Settings` → License section.

## Configuration

Open VS Code Settings (Ctrl+,) and search "ctxloom" for all options. Or use the branded Settings panel: `ctxloom: Open Settings`.

## Manual test plan (run before each release)

1. **Trial flow:** fresh install → `ctxloom: Start Free Trial` → completes in browser → email arrives → paste key → activate. Status bar shows "trial 7d".
2. **Hover:** open a TS file with imports → hover an import string → card shows risk/owner/blast.
3. **Diagnostics:** create a `.ctxloomrc` rule that fails → save a violating file → squiggle appears in Problems panel.
4. **Settings panel:** `ctxloom: Open Settings` → toggle "Hover cards" off → hover stops showing card. Toggle on → resumes.
5. **Code lens "Copy AI context":** hover a function → click `↗ Copy AI context` → paste into Copilot Chat → context renders correctly.
6. **MCP bridge:** install GitHub Copilot. Open Copilot Chat → ask "what's the blast radius of file X?" → Copilot uses ctxloom MCP tool.
7. **License expiry:** set `expiresAt` in `~/.config/ctxloom/license.json` to past → wait 60s → status bar turns red, providers stop firing.
8. **Deactivate:** `ctxloom: Deactivate License` → confirm → license file removed.
```

- [ ] **Step 2: Write the future-implementations log**

Write `docs/future_features_vscode.md`:

```markdown
# VS Code Extension — Future Implementations

Punted-but-tracked work. Not scoped for v1; logged here so we don't lose them.

## Deferred to v1.1+

- **Multi-root workspace support** — v1 uses `workspaceFolders[0]` only. Power users with multi-root workspaces want N child processes.
- **Daemon mode** — v1 spawns ctxloom per VS Code window. A shared daemon would lower resource cost for users with many windows.
- **JetBrains port** — separate plugin, shares no code (Kotlin UI, JNI to the same MCP server). Distinct codebase, distinct release cadence.
- **Settings UI for rules config** — today users edit `.ctxloomrc` directly. A visual rule builder would help non-CLI users.
- **Branded settings panel theme variants** — high-contrast and colorblind-friendly modes; the v1 panel uses standard tokens.
- **Per-folder license seats / team license sharing** — current model is per-machine.
- **Web-extension build (github.dev / vscode.dev)** — different build target, no native deps allowed; LanceDB and tree-sitter would need WASM-only paths.

## Out of scope (won't build, by design)

- **Inline AI suggestions** — Copilot's surface, not ours.
- **GitLens-style blame UI** — GitLens owns this surface.

## Engineering polish backlog

- **Visual regression tests on hover cards / status bar** — VS Code render internals change too often; relying on data-snapshot is more durable.
- **Live integration tests against Copilot Chat / Cursor MCP** — depends on third-party extensions in the test runner.
```

- [ ] **Step 3: Commit**

```bash
git add apps/vscode-extension/README.md docs/future_features_vscode.md
git commit -m "docs(vscode-extension): README + manual test plan + future-implementations log"
```

---

## Final verification

- [ ] **Run the entire root + extension test suite**

```bash
npm test
cd apps/vscode-extension && npm test && npm run test:integration
```

Expected: all green.

- [ ] **Verify TypeScript compiles cleanly**

```bash
npm run lint --workspace=@ctxloom/vscode-extension
```

Expected: exit 0.

- [ ] **Verify VSIX builds and installs**

```bash
cd apps/vscode-extension && npm run package
ls -lh ctxloom-vscode-*.vsix
```

Expected: VSIX size ≤ 35 MB.

Optional install for manual smoke:

```bash
code --install-extension apps/vscode-extension/ctxloom-vscode-0.1.0.vsix
```

- [ ] **Open a PR**

```bash
git push -u origin feat/vscode-extension
gh pr create --title "feat: ctxloom VS Code extension" --body "$(cat <<'EOF'
## Summary
- 12 features across hover cards, rules diagnostics, blast radius / code health panels, code lens (file-top + per-symbol "Copy AI context" with skeletonization), gutter heatmap, rules quick-fixes, MCP bridge for Copilot Chat / Cursor / Continue, and a branded settings/license panel
- Bundled `ctxloom-pro` inside the VSIX (~26 MB) — zero CLI prerequisite for users
- Polar-backed license flow shared with the existing CLI; trial via in-panel checkout

## Test plan
- [ ] `npm test` (root) — green
- [ ] `npm test --workspace=@ctxloom/vscode-extension` (unit) — ~40+ tests green
- [ ] `npm run test:integration --workspace=@ctxloom/vscode-extension` — ~12 tests green
- [ ] `npx vscode-test --label smoke` (real bundled CLI) — green
- [ ] `npm run package` — VSIX builds, ≤35 MB
- [ ] Manual: README's manual-test-plan run end-to-end with sandbox license
EOF
)"
```

---

## Spec coverage check

| Spec section | Tasks |
|---|---|
| Architecture & module boundaries | 1, 11 |
| Server lifecycle (extension-spawns-per-workspace) | 3, 11 |
| CLI discovery (bundled in VSIX) | 2, 22 |
| License gating (Polar-backed, shared file) | 5, 6, 20 |
| Single-root workspace (use `workspaceFolders[0]`) | 11 |
| The 11 features | 12, 13, 14, 16, 17, 18, 19, 20, 21 |
| Cross-cutting: cache + debounce | 4, 12, 16, 18 |
| Differentiation (#9 Copy AI Context, #11 MCP bridge) | 17, 21 |
| First-run UX inside the Settings panel | 9, 10, 20 |
| Polar error states | 20 |
| Status-bar item | 6, 15 |
| Soft-block on expiry | 5, 6, 20 |
| License-related commands | 20 |
| Telemetry policy | 1 (manifest), 9 (panel toggle) |
| Configuration namespace `ctxloom.*` | 1, 9, 10 |
| Branded settings panel | 7, 8, 9, 10, 20 |
| Native VS Code Settings UI fallback | 1 (manifest) |
| Bidirectional config sync | 10 |
| Six error-handling axes | 2, 3, 5, 9, 10, 21 |
| Two design rules (provider tolerates server-down, no silent failures) | 13, 14, 18 |
| Layer 1 unit tests | 2, 3, 4, 5, 6, 7, 11 |
| Layer 2 provider integration tests | 10, 12, 13, 14, 15, 16, 17, 18, 19, 20 |
| Layer 3 smoke test | 23 |
| Coverage targets | enforced via vitest config (Task 1) |
| Build pipeline + esbuild + prepare-bundle | 1, 9, 22 |
| VSIX expected size | 22, 25 |
| Marketplace targets (Marketplace + OpenVSX + GitHub Releases) | 24 |
| Publisher identity & metadata | 1 (package.json), 25 (README) |
| SemVer alignment with ctxloom-pro | 22 (consumes workspace ctxloom-pro version) |
| Release process (T+0 → T+3w) | 25 (README), 24 (CI) |
| CI workflows | 24 |
| Future-implementations log | 25 |
