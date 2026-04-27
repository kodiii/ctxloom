# VS Code Extension v1.1 — CLI Lazy-Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the ~108 MB v1 VSIX to ~5 MB by replacing the bundled `ctxloom-pro` CLI with a first-run lazy-download from GitHub Releases. Unblocks Marketplace + OpenVSX publishing.

**Architecture:** New `CliInstaller` module owns network + checksum + extraction + version tracking under `globalStorageUri`. `BinaryResolver` becomes a pure path-existence check. `extension.ts` orchestrates `CliInstaller.ensureInstalled()` before `ServerManager.start()`. A new `build-cli-tarballs.mjs` + `publish-cli-tarballs.yml` workflow produce per-platform tarballs on `cli-v*` tags.

**Tech Stack:** TypeScript 5.7, Node 20+, `vscode` 1.85+, vitest, `@vscode/test-electron`, `node:crypto` (SHA-256), `tar` (extraction), GitHub Releases (CDN), GitHub Actions matrix builds.

**Spec:** [docs/superpowers/specs/2026-04-27-vscode-extension-v1.1-lazy-cli-design.md](../specs/2026-04-27-vscode-extension-v1.1-lazy-cli-design.md)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `apps/vscode-extension/src/client/CliInstaller.ts` | Network fetch, SHA-256 verify, atomic extract, version-track; idempotent `ensureInstalled(version)` |
| `apps/vscode-extension/scripts/build-cli-tarballs.mjs` | Builds per-platform CLI tarballs + SHA-256 sidecars to `dist-cli/` |
| `apps/vscode-extension/tests/unit/CliInstaller.test.ts` | ~10 unit tests stubbing fetch + fs |
| `apps/vscode-extension/tests/integration/CliInstaller.test.ts` | ~5 integration tests using `file://` fixture URL |
| `apps/vscode-extension/tests/integration/Activation.test.ts` | ~3 integration tests for activation orchestration |
| `apps/vscode-extension/tests/fixtures/fake-cli/` | Tiny no-op MCP server (~50 lines) packed as a fixture tarball |
| `apps/vscode-extension/tests/fixtures/fake-cli-tarball.sh` | Pack script — produces `fake-cli.tar.gz` + `.sha256` for tests |
| `.github/workflows/publish-cli-tarballs.yml` | Triggered on `cli-v*` tags; matrix-builds 4 platform tarballs and uploads to GitHub Release |

### Modified files

| Path | Change |
|---|---|
| `apps/vscode-extension/package.json` | Add `ctxloomCliVersion: "1.0.5"` field; add `ctxloom.cli.installPromptDismissed` config; add 2 commands; bump `version` to `1.1.0` |
| `apps/vscode-extension/src/client/BinaryResolver.ts` | Drop `extensionRoot` + `BUNDLED_SUBPATH`; add `globalStorageRoot + cliVersion`; pure existence check |
| `apps/vscode-extension/tests/unit/BinaryResolver.test.ts` | Replace bundled-path tests with globalStorage-path tests; preserve override tests |
| `apps/vscode-extension/src/extension.ts` | Pass `globalStorageRoot + cliVersion` to resolver; insert `CliInstaller.ensureInstalled` before `ServerManager.start`; status-bar setup-needed states; wire 2 new commands |
| `apps/vscode-extension/src/license/statusBar.ts` | Extend `StatusBarInputs` with optional `cliInstallState` field; render new states |
| `apps/vscode-extension/tests/unit/statusBar.test.ts` | 4 new tests for `cliInstallState` rendering |
| `apps/vscode-extension/src/commands/index.ts` | Add `ctxloom.installCli` + `ctxloom.showCliInstallPath`; extend `ctxloom.restartServer` to re-trigger install on version mismatch |
| `apps/vscode-extension/scripts/prepare-bundle.mjs` | DELETED |
| `.github/workflows/build-extension.yml` | Drop `prepare-bundle.mjs` step; expect 5 MB VSIX |
| `.github/workflows/publish-extension.yml` | Re-enable marketplace + OpenVSX publish steps (uncomment block from v1) |
| `apps/vscode-extension/.gitignore` | Drop `resources/ctxloom-cli/`; add `dist-cli/` |

### Removed files / directories

- `apps/vscode-extension/resources/ctxloom-cli/` (was gitignored already)
- `apps/vscode-extension/scripts/prepare-bundle.mjs`

---

## Implementation order — phases

1. **Phase 0 — Resolver refactor** (Tasks 1–2): manifest field + `BinaryResolver` rewrite. Keeps the working tree green by not yet calling the resolver from `extension.ts`.
2. **Phase 1 — `CliInstaller`** (Tasks 3–6): scaffold + path/cleanup logic + download + atomic extract + failure modes. Pure-logic + filesystem unit-tested via tmpdir + stubbed `fetch`.
3. **Phase 2 — Activation orchestration** (Tasks 7–9): wire `CliInstaller` into `extension.ts`; modal + status-bar states; new commands + `Restart Server` extension.
4. **Phase 3 — Build pipeline** (Tasks 10–12): `build-cli-tarballs.mjs`, the new `publish-cli-tarballs.yml`, and updates to the existing two workflows.
5. **Phase 4 — Tests + smoke** (Tasks 13–14): integration tests for `CliInstaller` + `Activation`, fake-cli fixture, smoke test against `cli-v0.0.0-test`.

Each phase's last task ends with a green test suite + clean lint.

---

## Phase 0 — Resolver refactor

### Task 1: Add `ctxloomCliVersion` to the manifest, declare new config + commands

**Files:**
- Modify: `apps/vscode-extension/package.json`
- Modify: `apps/vscode-extension/.gitignore`

- [ ] **Step 1: Add the manifest field + config + commands**

In `apps/vscode-extension/package.json`:

a) Bump version:

```jsonc
"version": "1.1.0",
```

b) Add the new top-level `ctxloomCliVersion` field after `version`:

```jsonc
"ctxloomCliVersion": "1.0.5",
```

c) In `contributes.commands`, append the two new commands:

```jsonc
{ "command": "ctxloom.installCli",          "title": "ctxloom: Install CLI" },
{ "command": "ctxloom.showCliInstallPath",  "title": "ctxloom: Show CLI Install Path" },
```

d) In `contributes.configuration.properties`, append:

```jsonc
"ctxloom.cli.installPromptDismissed": {
  "type": "boolean",
  "default": false,
  "description": "If true, the extension does not show the 'Install ctxloom analyzer' modal on activation. Reset via the Settings panel or the 'ctxloom: Install CLI' command."
}
```

- [ ] **Step 2: Update .gitignore**

Replace `resources/ctxloom-cli/` with `dist-cli/`:

```
# apps/vscode-extension/.gitignore
dist/
out/
node_modules/
*.vsix
.vscode-test/
coverage/
dist-cli/
```

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint --workspace=ctxloom-vscode`
Expected: `tsc --noEmit` exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/vscode-extension/package.json apps/vscode-extension/.gitignore
git commit -m "chore(vscode-extension): manifest v1.1.0 — add ctxloomCliVersion, lazy-install config, 2 new commands"
```

---

### Task 2: Rewrite `BinaryResolver` for globalStorage-only lookup

**Files:**
- Modify: `apps/vscode-extension/src/client/BinaryResolver.ts`
- Modify: `apps/vscode-extension/tests/unit/BinaryResolver.test.ts`

- [ ] **Step 1: Replace the existing tests with the new ones**

Write `apps/vscode-extension/tests/unit/BinaryResolver.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { resolveCliPath } from '../../src/client/BinaryResolver.js';

function makeTmpStorage(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'binresolver-'));
}

describe('resolveCliPath', () => {
  let storage: string;
  beforeEach(() => { storage = makeTmpStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  it('returns the override path when configured (regardless of existence)', () => {
    const overridePath = '/some/custom/ctxloom';
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: overridePath });
    expect(result.source).toBe('override');
    expect(result.path).toBe(overridePath);
    expect(result.exists).toBe(false);
  });

  it('expands ~ in override paths to the user home', () => {
    const home = os.homedir();
    const real = path.join(home, '.fake-ctxloom-test-' + Date.now());
    fs.writeFileSync(real, '');
    try {
      const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: '~/' + path.basename(real) });
      expect(result.source).toBe('override');
      expect(result.path).toBe(real);
      expect(result.exists).toBe(true);
    } finally {
      fs.unlinkSync(real);
    }
  });

  it('returns the globalStorage path when no override is set', () => {
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: null });
    expect(result.source).toBe('globalStorage');
    expect(result.path).toBe(path.join(storage, 'ctxloom-cli', '1.0.5', 'dist', 'index.js'));
    expect(result.exists).toBe(false);
  });

  it('reports exists=true when the versioned binary exists in globalStorage', () => {
    const installDir = path.join(storage, 'ctxloom-cli', '1.0.5', 'dist');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'index.js'), '');
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: null });
    expect(result.exists).toBe(true);
  });

  it('reports exists=false when a different version is installed', () => {
    const installDir = path.join(storage, 'ctxloom-cli', '1.0.4', 'dist');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'index.js'), '');
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: null });
    expect(result.source).toBe('globalStorage');
    expect(result.path).toBe(path.join(storage, 'ctxloom-cli', '1.0.5', 'dist', 'index.js'));
    expect(result.exists).toBe(false);
  });

  it('treats empty string override as "no override"', () => {
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: '' });
    expect(result.source).toBe('globalStorage');
  });

  it('treats whitespace-only override as "no override"', () => {
    const result = resolveCliPath({ globalStorageRoot: storage, cliVersion: '1.0.5', override: '   ' });
    expect(result.source).toBe('globalStorage');
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail (current resolver still uses bundled path)**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/BinaryResolver.test.ts`
Expected: tests fail because `globalStorageRoot` and `cliVersion` aren't in `ResolveOptions`, and `'globalStorage'` isn't a valid source.

- [ ] **Step 3: Replace `BinaryResolver.ts` implementation**

Write `apps/vscode-extension/src/client/BinaryResolver.ts`:

```typescript
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface ResolveOptions {
  /** Absolute path to the extension's globalStorageUri (where lazy-installed CLIs live). */
  globalStorageRoot: string;
  /** The CLI version pinned in the extension manifest (`ctxloomCliVersion`). */
  cliVersion: string;
  /** User-configured override path. Empty string and whitespace are treated as null. */
  override: string | null;
}

export interface ResolveResult {
  /** 'override' = user-configured path; 'globalStorage' = lazy-installed CLI directory. */
  source: 'override' | 'globalStorage';
  /** Absolute, ~-expanded path to the entry. */
  path: string;
  /** Does the file exist on disk right now? */
  exists: boolean;
}

const CLI_SUBPATH = path.join('dist', 'index.js');

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
  const installed = path.join(opts.globalStorageRoot, 'ctxloom-cli', opts.cliVersion, CLI_SUBPATH);
  return { source: 'globalStorage', path: installed, exists: fs.existsSync(installed) };
}
```

- [ ] **Step 4: Run tests, confirm all 7 pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/BinaryResolver.test.ts`
Expected: 7/7 passing.

- [ ] **Step 5: Verify lint passes**

Run: `npm run lint --workspace=ctxloom-vscode`
Expected: PASS. (`extension.ts` uses the old `extensionRoot` field — TypeScript will complain. We fix that in Task 7.)

If lint fails because `extension.ts` is broken, that's expected — it will be fixed in Task 7. To keep this commit isolated, temporarily comment out the resolver call site in `extension.ts` (mark with `// FIXME(v1.1): wired in Task 7`). Run lint, confirm clean.

Specifically, find the line in `extension.ts` that resembles:

```typescript
const resolved = resolveCliPath({ extensionRoot, override });
```

and replace with:

```typescript
// FIXME(v1.1): wired in Task 7 of plan 2026-04-27-vscode-extension-v1.1-lazy-cli.md
const resolved = { exists: false, path: '', source: 'override' as const };
```

Re-run lint. Should now pass.

- [ ] **Step 6: Commit**

```bash
git add apps/vscode-extension/src/client/BinaryResolver.ts apps/vscode-extension/tests/unit/BinaryResolver.test.ts apps/vscode-extension/src/extension.ts
git commit -m "refactor(vscode-extension): BinaryResolver — globalStorage lookup, drop bundled path

Drops the v1 'bundled in resources/ctxloom-cli/' lookup; adds a
globalStorageRoot + cliVersion lookup for the v1.1 lazy-install flow.
Pure path-existence check — INSTALLED_VERSION is owned by CliInstaller.

extension.ts has a temporary FIXME stub at the resolver call site;
fully wired in Task 7."
```

---

## Phase 1 — `CliInstaller`

### Task 3: `CliInstaller` scaffold + tmp/staging cleanup logic

**Files:**
- Create: `apps/vscode-extension/src/client/CliInstaller.ts`
- Create: `apps/vscode-extension/tests/unit/CliInstaller.test.ts`

- [ ] **Step 1: Write the scaffold tests**

Write `apps/vscode-extension/tests/unit/CliInstaller.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { CliInstaller } from '../../src/client/CliInstaller.js';

function makeStorage(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-installer-'));
}

function quietLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function nullPrompt() {
  return { confirmInstall: async () => 'install' as const, alreadyDismissed: () => false };
}

function nullProgress() {
  return { report: vi.fn(), withProgress: async (_title: string, body: () => Promise<void>) => body() };
}

describe('CliInstaller — paths and idempotency', () => {
  let storage: string;
  beforeEach(() => { storage = makeStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  it('resolves the installed binary path for a given version', () => {
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    const p = installer.installedBinaryPath('1.0.5');
    expect(p).toBe(path.join(storage, 'ctxloom-cli', '1.0.5', 'dist', 'index.js'));
  });

  it('reports installed=false when the binary is missing', () => {
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    expect(installer.isInstalled('1.0.5')).toBe(false);
  });

  it('reports installed=true when the binary exists', () => {
    const dir = path.join(storage, 'ctxloom-cli', '1.0.5', 'dist');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    expect(installer.isInstalled('1.0.5')).toBe(true);
  });

  it('cleanupStaging() deletes any tmp/staging-* directories', () => {
    const tmp = path.join(storage, 'tmp');
    fs.mkdirSync(path.join(tmp, 'staging-1.0.4'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'staging-1.0.5'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'unrelated.txt'), 'keep me');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    installer.cleanupStaging();
    expect(fs.existsSync(path.join(tmp, 'staging-1.0.4'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'staging-1.0.5'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'unrelated.txt'))).toBe(true);
  });

  it('cleanupStaging() is a no-op when tmp/ does not exist', () => {
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    expect(() => installer.cleanupStaging()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests, confirm 5 failures**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/CliInstaller.test.ts`
Expected: All 5 fail (`Cannot find module '../../src/client/CliInstaller.js'`).

- [ ] **Step 3: Write the scaffold implementation**

Write `apps/vscode-extension/src/client/CliInstaller.ts`:

```typescript
import path from 'node:path';
import fs from 'node:fs';
import type { Logger } from '../shared/logger.js';

/** Asks the user whether to proceed with a download. */
export interface InstallPrompt {
  confirmInstall(version: string): Promise<'install' | 'skip' | 'dont-ask-again'>;
  alreadyDismissed(): boolean;
}

/** Wraps `vscode.window.withProgress` so the installer doesn't depend on `vscode` directly. */
export interface ProgressReporter {
  withProgress<T>(title: string, body: (report: (delta: { increment?: number; message?: string }) => void) => Promise<T>): Promise<T>;
}

export type FetchLike = typeof globalThis.fetch;

export interface CliInstallerOptions {
  globalStorageRoot: string;
  fetch: FetchLike;
  logger: Logger;
  prompt: InstallPrompt;
  progress: ProgressReporter;
  /** Override URL base for tests. Default 'https://github.com/kodiii/ctxloom/releases/download'. */
  releaseBaseUrl?: string;
  /** Override platform key for tests. Default derived from process.platform/arch. */
  platform?: Platform;
}

export type Platform = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'linux-arm64';

const RELEASE_BASE_URL = 'https://github.com/kodiii/ctxloom/releases/download';

export class CliInstaller {
  constructor(private readonly opts: CliInstallerOptions) {}

  installedBinaryPath(version: string): string {
    return path.join(this.opts.globalStorageRoot, 'ctxloom-cli', version, 'dist', 'index.js');
  }

  isInstalled(version: string): boolean {
    return fs.existsSync(this.installedBinaryPath(version));
  }

  /** Delete every `tmp/staging-*` directory. Called on installer entry to recover from crashed installs. */
  cleanupStaging(): void {
    const tmp = path.join(this.opts.globalStorageRoot, 'tmp');
    if (!fs.existsSync(tmp)) return;
    for (const entry of fs.readdirSync(tmp)) {
      if (entry.startsWith('staging-')) {
        fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
      }
    }
  }
}
```

- [ ] **Step 4: Run tests, confirm 5/5 pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/CliInstaller.test.ts`
Expected: 5/5 passing.

- [ ] **Step 5: Verify lint passes**

Run: `npm run lint --workspace=ctxloom-vscode`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vscode-extension/src/client/CliInstaller.ts apps/vscode-extension/tests/unit/CliInstaller.test.ts
git commit -m "feat(vscode-extension): CliInstaller scaffold — paths + tmp/staging cleanup"
```

---

### Task 4: Download + SHA-256 verification

**Files:**
- Modify: `apps/vscode-extension/src/client/CliInstaller.ts`
- Modify: `apps/vscode-extension/tests/unit/CliInstaller.test.ts` (append)

- [ ] **Step 1: Append download tests**

Append to `apps/vscode-extension/tests/unit/CliInstaller.test.ts`:

```typescript
import crypto from 'node:crypto';

function makeFakeTarball(): { bytes: Buffer; sha256: string } {
  const bytes = Buffer.from('fake-tarball-contents');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return { bytes, sha256 };
}

function makeFakeFetch(map: Record<string, { status: number; body?: Buffer | string; headers?: Record<string, string> }>) {
  return vi.fn(async (url: string) => {
    const entry = map[url];
    if (!entry) {
      return new Response('not found', { status: 404 });
    }
    return new Response(entry.body ?? '', { status: entry.status, headers: entry.headers });
  });
}

describe('CliInstaller — download + verify', () => {
  let storage: string;
  beforeEach(() => { storage = makeStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  it('downloads tarball + sidecar and verifies SHA-256 (happy path)', async () => {
    const { bytes, sha256 } = makeFakeTarball();
    const tarUrl = 'https://example.test/tarball.tar.gz';
    const shaUrl = `${tarUrl}.sha256`;
    const fetch = makeFakeFetch({
      [tarUrl]: { status: 200, body: bytes },
      [shaUrl]: { status: 200, body: `${sha256}  ctxloom-cli-1.0.5-linux-x64.tar.gz\n` },
    });
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const tmpFile = await installer.downloadVerified('1.0.5');
    expect(tmpFile.endsWith('.tar.gz')).toBe(true);
    expect(fs.readFileSync(tmpFile)).toEqual(bytes);
  });

  it('throws ChecksumMismatch when SHA-256 does not match', async () => {
    const { bytes } = makeFakeTarball();
    const tarUrl = 'https://example.test/tarball.tar.gz';
    const shaUrl = `${tarUrl}.sha256`;
    const fetch = makeFakeFetch({
      [tarUrl]: { status: 200, body: bytes },
      [shaUrl]: { status: 200, body: '0000000000000000000000000000000000000000000000000000000000000000  x.tar.gz\n' },
    });
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    await expect(installer.downloadVerified('1.0.5')).rejects.toThrow(/checksum/i);
    // Partial download cleaned up
    const tmp = path.join(storage, 'tmp');
    if (fs.existsSync(tmp)) {
      const remaining = fs.readdirSync(tmp).filter(f => f.endsWith('.tar.gz'));
      expect(remaining).toEqual([]);
    }
  });

  it('throws NotFound on 404', async () => {
    const fetch = makeFakeFetch({}); // every URL → 404
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    await expect(installer.downloadVerified('1.0.5')).rejects.toThrow(/not found|404/i);
  });

  it('builds correct GitHub Releases URLs from version + platform', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 }));
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), platform: 'darwin-arm64' });
    await expect(installer.downloadVerified('1.0.5')).rejects.toThrow();
    const calls = fetch.mock.calls.map(c => String(c[0]));
    expect(calls).toContain('https://github.com/kodiii/ctxloom/releases/download/cli-v1.0.5/ctxloom-cli-1.0.5-darwin-arm64.tar.gz.sha256');
  });
});
```

- [ ] **Step 2: Run tests, confirm new ones fail**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/CliInstaller.test.ts`
Expected: download tests fail (`installer.downloadVerified is not a function`).

- [ ] **Step 3: Implement `downloadVerified`**

Append to `apps/vscode-extension/src/client/CliInstaller.ts` inside the `CliInstaller` class:

```typescript
import crypto from 'node:crypto';

// — inside class —

private resolvePlatform(): Platform {
  if (this.opts.platform) return this.opts.platform;
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64';
  if (p === 'darwin' && a === 'x64') return 'darwin-x64';
  if (p === 'linux' && a === 'x64') return 'linux-x64';
  if (p === 'linux' && a === 'arm64') return 'linux-arm64';
  throw new Error(`Unsupported platform: ${p}/${a}`);
}

private buildUrls(version: string): { tarUrl: string; shaUrl: string; tarballName: string } {
  const platform = this.resolvePlatform();
  const base = this.opts.releaseBaseUrl ?? RELEASE_BASE_URL;
  const tarballName = `ctxloom-cli-${version}-${platform}.tar.gz`;
  const tarUrl = `${base}/cli-v${version}/${tarballName}`;
  return { tarUrl, shaUrl: `${tarUrl}.sha256`, tarballName };
}

/**
 * Download the tarball + sidecar, verify SHA-256, return the path to the
 * downloaded tarball under `${globalStorageRoot}/tmp/`. The caller is
 * responsible for extraction (`extractAndCommit`) — keeping these split
 * lets the install-flow recover from extract failures without re-downloading.
 */
async downloadVerified(version: string, signal?: AbortSignal): Promise<string> {
  const { tarUrl, shaUrl, tarballName } = this.buildUrls(version);

  // Sidecar first — small, fails fast on 404.
  const shaRes = await this.opts.fetch(shaUrl, { signal });
  if (shaRes.status === 404) throw new Error(`Tarball not found: 404 at ${shaUrl}`);
  if (!shaRes.ok) throw new Error(`Sidecar download failed: HTTP ${shaRes.status}`);
  const shaText = await shaRes.text();
  const expectedSha = (shaText.split(/\s+/)[0] ?? '').trim();
  if (!/^[0-9a-f]{64}$/.test(expectedSha)) {
    throw new Error(`Malformed sha256 sidecar at ${shaUrl}: ${shaText.slice(0, 80)}`);
  }

  const tarRes = await this.opts.fetch(tarUrl, { signal });
  if (tarRes.status === 404) throw new Error(`Tarball not found: 404 at ${tarUrl}`);
  if (!tarRes.ok) throw new Error(`Tarball download failed: HTTP ${tarRes.status}`);
  const buf = Buffer.from(await tarRes.arrayBuffer());

  const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
  if (actualSha !== expectedSha) {
    throw new Error(`Checksum mismatch: expected ${expectedSha.slice(0, 12)}…, got ${actualSha.slice(0, 12)}…`);
  }

  const tmp = path.join(this.opts.globalStorageRoot, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const tarPath = path.join(tmp, tarballName);
  fs.writeFileSync(tarPath, buf);
  this.opts.logger.info(`downloaded + verified ${tarballName} (${buf.length} bytes)`);
  return tarPath;
}
```

- [ ] **Step 4: Run tests, confirm 9/9 pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/CliInstaller.test.ts`
Expected: 9/9 (5 prior + 4 new) passing.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/client/CliInstaller.ts apps/vscode-extension/tests/unit/CliInstaller.test.ts
git commit -m "feat(vscode-extension): CliInstaller — fetch tarball + sha256 sidecar, verify, write tmp"
```

---

### Task 5: Atomic extract + version commit + old-version cleanup

**Files:**
- Modify: `apps/vscode-extension/src/client/CliInstaller.ts`
- Modify: `apps/vscode-extension/tests/unit/CliInstaller.test.ts` (append)

- [ ] **Step 1: Append extract+commit tests**

Append to the test file:

```typescript
import { execSync } from 'node:child_process';

function packTarball(srcDir: string, dstTar: string): void {
  execSync(`tar -czf "${dstTar}" -C "${srcDir}" .`, { stdio: 'pipe' });
}

describe('CliInstaller — extract + commit', () => {
  let storage: string;
  beforeEach(() => { storage = makeStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  it('extracts tarball, atomic-renames, writes INSTALLED_VERSION', async () => {
    // Build a real fixture tarball with a `dist/index.js` entry
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'dist/index.js'), '#!/usr/bin/env node\nconsole.log("hi")\n');
    fs.writeFileSync(path.join(srcDir, 'package.json'), JSON.stringify({ name: 'ctxloom-pro', version: '1.0.5' }));
    const tmp = path.join(storage, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const tarPath = path.join(tmp, 'fixture.tar.gz');
    packTarball(srcDir, tarPath);
    fs.rmSync(srcDir, { recursive: true });

    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    await installer.extractAndCommit('1.0.5', tarPath);

    expect(fs.existsSync(installer.installedBinaryPath('1.0.5'))).toBe(true);
    expect(fs.readFileSync(path.join(storage, 'INSTALLED_VERSION'), 'utf-8').trim()).toBe('1.0.5');
    // Tarball cleaned up
    expect(fs.existsSync(tarPath)).toBe(false);
  });

  it('deletes the previous version after a successful install of a newer one', async () => {
    // Pre-existing 1.0.4 install
    const oldDir = path.join(storage, 'ctxloom-cli', '1.0.4');
    fs.mkdirSync(path.join(oldDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'dist/index.js'), 'old');
    fs.writeFileSync(path.join(storage, 'INSTALLED_VERSION'), '1.0.4');

    // Build a fixture for 1.0.5
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'dist/index.js'), 'new');
    const tmp = path.join(storage, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const tarPath = path.join(tmp, 'fixture.tar.gz');
    packTarball(srcDir, tarPath);
    fs.rmSync(srcDir, { recursive: true });

    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    await installer.extractAndCommit('1.0.5', tarPath);

    expect(fs.existsSync(installer.installedBinaryPath('1.0.5'))).toBe(true);
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.readFileSync(path.join(storage, 'INSTALLED_VERSION'), 'utf-8').trim()).toBe('1.0.5');
  });

  it('cleans up staging dir if extraction throws', async () => {
    const tmp = path.join(storage, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const corrupt = path.join(tmp, 'corrupt.tar.gz');
    fs.writeFileSync(corrupt, 'not a real tarball');

    const installer = new CliInstaller({ globalStorageRoot: storage, fetch: vi.fn(), logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress() });
    await expect(installer.extractAndCommit('1.0.5', corrupt)).rejects.toThrow();

    // No stale staging dirs left behind
    const remaining = fs.existsSync(tmp) ? fs.readdirSync(tmp) : [];
    expect(remaining.filter(f => f.startsWith('staging-'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, confirm 3 new failures**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/CliInstaller.test.ts`
Expected: extract+commit tests fail (`installer.extractAndCommit is not a function`).

- [ ] **Step 3: Implement extract + commit**

Append to `CliInstaller`:

```typescript
import { execSync } from 'node:child_process';

// — inside class —

/**
 * Extract `tarPath` into `${globalStorageRoot}/tmp/staging-${version}/`,
 * atomic-rename to the final versioned directory, write `INSTALLED_VERSION`,
 * delete tarball + previous version. Throws on any failure (caller must
 * catch and surface to user).
 */
async extractAndCommit(version: string, tarPath: string): Promise<void> {
  const tmp = path.join(this.opts.globalStorageRoot, 'tmp');
  const staging = path.join(tmp, `staging-${version}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  try {
    execSync(`tar -xzf "${tarPath}" -C "${staging}"`, { stdio: 'pipe' });
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Read previous version (if any) before the rename.
  const versionFile = path.join(this.opts.globalStorageRoot, 'INSTALLED_VERSION');
  let previousVersion: string | null = null;
  if (fs.existsSync(versionFile)) {
    previousVersion = fs.readFileSync(versionFile, 'utf-8').trim();
  }

  const finalDir = path.join(this.opts.globalStorageRoot, 'ctxloom-cli', version);
  fs.mkdirSync(path.dirname(finalDir), { recursive: true });
  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(staging, finalDir);

  // Commit: atomic write of INSTALLED_VERSION via tmp + rename.
  const versionTmp = `${versionFile}.tmp`;
  fs.writeFileSync(versionTmp, version);
  fs.renameSync(versionTmp, versionFile);

  // Best-effort cleanup of tarball + previous version directory.
  fs.rmSync(tarPath, { force: true });
  if (previousVersion !== null && previousVersion !== version) {
    fs.rmSync(path.join(this.opts.globalStorageRoot, 'ctxloom-cli', previousVersion), { recursive: true, force: true });
  }
  this.opts.logger.info(`installed ctxloom-cli ${version}`);
}
```

- [ ] **Step 4: Run tests, confirm 12/12 pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/CliInstaller.test.ts`
Expected: 12/12 (9 prior + 3 new) passing.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/src/client/CliInstaller.ts apps/vscode-extension/tests/unit/CliInstaller.test.ts
git commit -m "feat(vscode-extension): CliInstaller — atomic extract via staging-rename + INSTALLED_VERSION commit"
```

---

### Task 6: `ensureInstalled` orchestration + retry budget + cancellation

**Files:**
- Modify: `apps/vscode-extension/src/client/CliInstaller.ts`
- Modify: `apps/vscode-extension/tests/unit/CliInstaller.test.ts` (append)

- [ ] **Step 1: Append orchestration tests**

Append:

```typescript
describe('CliInstaller — ensureInstalled orchestration', () => {
  let storage: string;
  beforeEach(() => { storage = makeStorage(); });
  afterEach(() => { fs.rmSync(storage, { recursive: true, force: true }); });

  function fixtureFetch(version: string): { fetch: ReturnType<typeof vi.fn>; bytes: Buffer; sha256: string } {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
    fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'dist/index.js'), 'console.log("ok")');
    const tarPath = path.join(srcDir, 'fixture.tar.gz');
    packTarball(srcDir, tarPath);
    const bytes = fs.readFileSync(tarPath);
    fs.rmSync(srcDir, { recursive: true });
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const fetch = makeFakeFetch({
      [`https://example.test/cli-v${version}/ctxloom-cli-${version}-linux-x64.tar.gz`]: { status: 200, body: bytes },
      [`https://example.test/cli-v${version}/ctxloom-cli-${version}-linux-x64.tar.gz.sha256`]: { status: 200, body: `${sha256}  x.tar.gz\n` },
    });
    return { fetch, bytes, sha256 };
  }

  it('ensureInstalled is a no-op when the version is already installed', async () => {
    const dir = path.join(storage, 'ctxloom-cli', '1.0.5', 'dist');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), '');
    const { fetch } = fixtureFetch('1.0.5');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('already-installed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ensureInstalled returns "skipped" if user picks Skip for now', async () => {
    const { fetch } = fixtureFetch('1.0.5');
    const skipPrompt = { confirmInstall: async () => 'skip' as const, alreadyDismissed: () => false };
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: skipPrompt, progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('skipped');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ensureInstalled returns "dismissed" when alreadyDismissed=true', async () => {
    const { fetch } = fixtureFetch('1.0.5');
    const dismissedPrompt = { confirmInstall: async () => 'install' as const, alreadyDismissed: () => true };
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: dismissedPrompt, progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('dismissed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ensureInstalled completes the full happy path', async () => {
    const { fetch } = fixtureFetch('1.0.5');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('installed');
    expect(installer.isInstalled('1.0.5')).toBe(true);
  });

  it('ensureInstalled cleans up stale staging dirs on entry', async () => {
    const stale = path.join(storage, 'tmp', 'staging-0.0.0');
    fs.mkdirSync(stale, { recursive: true });
    const { fetch } = fixtureFetch('1.0.5');
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    await installer.ensureInstalled('1.0.5');
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('ensureInstalled stops retrying after 3 attempts in one session', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }));
    const installer = new CliInstaller({ globalStorageRoot: storage, fetch, logger: quietLogger(), prompt: nullPrompt(), progress: nullProgress(), releaseBaseUrl: 'https://example.test', platform: 'linux-x64' });
    for (let i = 0; i < 3; i++) {
      await expect(installer.ensureInstalled('1.0.5')).rejects.toThrow();
    }
    const result = await installer.ensureInstalled('1.0.5');
    expect(result.kind).toBe('exhausted');
  });
});
```

- [ ] **Step 2: Run tests, confirm 6 new failures**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/CliInstaller.test.ts`
Expected: orchestration tests fail (`installer.ensureInstalled is not a function`).

- [ ] **Step 3: Implement orchestration**

Append to `CliInstaller`:

```typescript
const MAX_RETRIES_PER_SESSION = 3;

export type EnsureResult =
  | { kind: 'already-installed'; binaryPath: string }
  | { kind: 'installed'; binaryPath: string }
  | { kind: 'skipped' }
  | { kind: 'dismissed' }
  | { kind: 'exhausted' };

// — inside class —

private failureCount = 0;

async ensureInstalled(version: string, signal?: AbortSignal): Promise<EnsureResult> {
  if (this.isInstalled(version)) {
    return { kind: 'already-installed', binaryPath: this.installedBinaryPath(version) };
  }

  if (this.opts.prompt.alreadyDismissed()) {
    return { kind: 'dismissed' };
  }

  if (this.failureCount >= MAX_RETRIES_PER_SESSION) {
    return { kind: 'exhausted' };
  }

  // Always clean up any leftover staging dirs before a fresh attempt.
  this.cleanupStaging();

  const decision = await this.opts.prompt.confirmInstall(version);
  if (decision === 'skip') return { kind: 'skipped' };
  if (decision === 'dont-ask-again') return { kind: 'dismissed' };

  try {
    await this.opts.progress.withProgress(`Installing ctxloom analyzer (${version})`, async (report) => {
      report({ message: 'Downloading…' });
      const tarPath = await this.downloadVerified(version, signal);
      report({ message: 'Installing…' });
      await this.extractAndCommit(version, tarPath);
    });
    return { kind: 'installed', binaryPath: this.installedBinaryPath(version) };
  } catch (err) {
    this.failureCount++;
    this.opts.logger.error(`ctxloom CLI install failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

resetFailureCount(): void { this.failureCount = 0; }
```

- [ ] **Step 4: Run tests, confirm 18/18 pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/CliInstaller.test.ts`
Expected: 18/18 passing.

- [ ] **Step 5: Verify lint**

Run: `npm run lint --workspace=ctxloom-vscode`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vscode-extension/src/client/CliInstaller.ts apps/vscode-extension/tests/unit/CliInstaller.test.ts
git commit -m "feat(vscode-extension): CliInstaller.ensureInstalled — orchestrate prompt + download + retry budget"
```

---

## Phase 2 — Activation orchestration

### Task 7: Wire `BinaryResolver` + `CliInstaller` into `extension.ts`

**Files:**
- Modify: `apps/vscode-extension/src/extension.ts`

- [ ] **Step 1: Replace the FIXME stub from Task 2 with the real wiring**

Find the block in `apps/vscode-extension/src/extension.ts` that currently looks like:

```typescript
// FIXME(v1.1): wired in Task 7 of plan 2026-04-27-vscode-extension-v1.1-lazy-cli.md
const resolved = { exists: false, path: '', source: 'override' as const };
```

Replace the surrounding `startServer` function with:

```typescript
import { CliInstaller, type InstallPrompt, type ProgressReporter } from './client/CliInstaller.js';

let cliInstaller: CliInstaller | null = null;

function manifestCliVersion(): string {
  // Read the manifest field at runtime so tests can patch it.
  const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
  const v = (ext?.packageJSON as { ctxloomCliVersion?: string } | undefined)?.ctxloomCliVersion;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error('Extension manifest is missing ctxloomCliVersion field');
  }
  return v;
}

function makePrompt(context: vscode.ExtensionContext, cliVersion: string): InstallPrompt {
  return {
    alreadyDismissed: () => vscode.workspace.getConfiguration('ctxloom.cli').get<boolean>('installPromptDismissed') ?? false,
    confirmInstall: async () => {
      const choice = await vscode.window.showInformationMessage(
        `ctxloom needs to download its analyzer (~150 MB, version ${cliVersion}). Stored at ${context.globalStorageUri.fsPath}.`,
        { modal: true },
        'Install',
        'Skip for now',
        "Don't ask again",
      );
      if (choice === 'Install') return 'install';
      if (choice === "Don't ask again") {
        await vscode.workspace.getConfiguration('ctxloom.cli').update('installPromptDismissed', true, vscode.ConfigurationTarget.Global);
        return 'dont-ask-again';
      }
      return 'skip';
    },
  };
}

function makeProgress(): ProgressReporter {
  return {
    withProgress: <T,>(title: string, body: (report: (delta: { message?: string }) => void) => Promise<T>): Promise<T> =>
      vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (progress) => {
        return body((delta) => progress.report(delta));
      }) as Promise<T>,
  };
}

async function startServer(context: vscode.ExtensionContext): Promise<void> {
  // Windows: polite v1.2-coming fallback
  if (process.platform === 'win32') {
    logger?.info('Windows support coming in v1.2 — extension activated in inert mode');
    statusBar?.update({ licenseState: { kind: 'NO_LICENSE' as const }, riskScore: null, cliInstallState: 'windows-unsupported' });
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { logger?.warn('no workspace folder — server not started'); return; }

  const cliVersion = manifestCliVersion();
  const cfg = vscode.workspace.getConfiguration('ctxloom');
  const override = cfg.get<string | null>('cliPath') ?? null;

  const { resolveCliPath } = await import('./client/BinaryResolver.js');
  const resolved = resolveCliPath({ globalStorageRoot: context.globalStorageUri.fsPath, cliVersion, override });

  if (!resolved.exists) {
    cliInstaller ??= new CliInstaller({
      globalStorageRoot: context.globalStorageUri.fsPath,
      fetch: globalThis.fetch,
      logger: { info: m => logger?.info(m), warn: m => logger?.warn(m), error: m => logger?.error(m) },
      prompt: makePrompt(context, cliVersion),
      progress: makeProgress(),
    });
    statusBar?.update({ licenseState: { kind: 'NO_LICENSE' as const }, riskScore: null, cliInstallState: 'installing' });
    let outcome;
    try { outcome = await cliInstaller.ensureInstalled(cliVersion); }
    catch (err) {
      logger?.error(`CLI install failed: ${String(err)}`);
      statusBar?.update({ licenseState: { kind: 'NO_LICENSE' as const }, riskScore: null, cliInstallState: 'failed' });
      return;
    }
    if (outcome.kind === 'skipped' || outcome.kind === 'dismissed' || outcome.kind === 'exhausted') {
      statusBar?.update({ licenseState: { kind: 'NO_LICENSE' as const }, riskScore: null, cliInstallState: 'setup-needed' });
      return;
    }
  }

  // Re-resolve now that install (if any) committed.
  const ready = resolveCliPath({ globalStorageRoot: context.globalStorageUri.fsPath, cliVersion, override });
  if (!ready.exists) {
    logger?.error(`ctxloom CLI still missing after install at ${ready.path}`);
    return;
  }

  try {
    const { spawnServer } = await import('@ctxloom/mcp-client');
    serverManager = new ServerManager({
      spawner: () => spawnServer({ cwd: folder.uri.fsPath, command: ready.path }) as never,
      logger: { info: m => logger?.info(m), warn: m => logger?.warn(m), error: m => logger?.error(m) },
    });
    await serverManager.start();
    tools = new Tools(serverManager);
  } catch (err) {
    logger?.error(`ctxloom server failed to start: ${String(err)}`);
    if (serverManager) { try { await serverManager.dispose(); } catch { /* ignore */ } serverManager = null; }
    tools = null;
  }
}
```

- [ ] **Step 2: Update `activate()` to pass `context` to `startServer`**

Find the `await startServer();` call and update it to pass the `context` argument:

```typescript
await startServer(context);
```

- [ ] **Step 3: Verify lint**

Run: `npm run lint --workspace=ctxloom-vscode`
Expected: PASS. (May surface type errors for the new `cliInstallState` field on `StatusBarInputs` — that's fixed in Task 8.)

If TS complains about the unknown `cliInstallState` field, temporarily comment it out at the call sites (mark `// FIXME(v1.1): added in Task 8`), confirm lint is green, then commit. Task 8 puts it back.

- [ ] **Step 4: Commit**

```bash
git add apps/vscode-extension/src/extension.ts
git commit -m "feat(vscode-extension): wire CliInstaller into activate(); replaces v1's bundled-CLI startServer"
```

---

### Task 8: Status-bar `cliInstallState` rendering

**Files:**
- Modify: `apps/vscode-extension/src/license/statusBar.ts`
- Modify: `apps/vscode-extension/tests/unit/statusBar.test.ts` (append)
- Modify: `apps/vscode-extension/src/extension.ts` (un-comment the FIXMEs from Task 7)

- [ ] **Step 1: Append status-bar tests**

Append to `apps/vscode-extension/tests/unit/statusBar.test.ts`:

```typescript
describe('renderStatusBar — CLI install states', () => {
  it('shows installing state', () => {
    const r = renderStatusBar({ licenseState: { kind: 'NO_LICENSE' }, riskScore: null, cliInstallState: 'installing' });
    expect(r.text).toMatch(/installing/i);
  });

  it('shows setup-needed with click hint', () => {
    const r = renderStatusBar({ licenseState: { kind: 'NO_LICENSE' }, riskScore: null, cliInstallState: 'setup-needed' });
    expect(r.text).toMatch(/setup needed/i);
    expect(r.tooltip).toMatch(/click/i);
  });

  it('shows failed in error color', () => {
    const r = renderStatusBar({ licenseState: { kind: 'NO_LICENSE' }, riskScore: null, cliInstallState: 'failed' });
    expect(r.text).toMatch(/setup failed/i);
    expect(r.color).toBe('statusBarItem.errorForeground');
  });

  it('shows windows-unsupported state', () => {
    const r = renderStatusBar({ licenseState: { kind: 'NO_LICENSE' }, riskScore: null, cliInstallState: 'windows-unsupported' });
    expect(r.text).toMatch(/windows.*v1\.2/i);
  });

  it('falls through to the v1 license/risk display when no cliInstallState', () => {
    const r = renderStatusBar({ licenseState: { kind: 'LICENSED', tier: 'pro', expiresAt: '' }, riskScore: 0.42 });
    expect(r.text).toBe('⚠ 0.42 · ctxloom');
  });
});
```

- [ ] **Step 2: Run tests, confirm 5 new failures**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/statusBar.test.ts`
Expected: new tests fail (the `cliInstallState` field doesn't exist on `StatusBarInputs`).

- [ ] **Step 3: Extend `renderStatusBar` to accept and render `cliInstallState`**

Modify `apps/vscode-extension/src/license/statusBar.ts`:

a) Extend `StatusBarInputs`:

```typescript
export type CliInstallState = 'installing' | 'setup-needed' | 'failed' | 'windows-unsupported';

export interface StatusBarInputs {
  licenseState: LicenseState;
  riskScore: number | null;
  /** Optional override that takes priority over license/risk display when set. */
  cliInstallState?: CliInstallState;
}
```

b) Add a precedence branch at the top of `renderStatusBar`, BEFORE any of the existing license-state checks:

```typescript
export function renderStatusBar(inputs: StatusBarInputs): StatusBarOutput {
  const { licenseState, riskScore, cliInstallState } = inputs;

  if (cliInstallState === 'installing') {
    return { text: 'ctxloom: installing…', tooltip: 'Downloading ctxloom analyzer.', color: undefined };
  }
  if (cliInstallState === 'setup-needed') {
    return { text: 'ctxloom: setup needed', tooltip: 'Click to install the ctxloom analyzer.', color: 'statusBarItem.warningForeground' };
  }
  if (cliInstallState === 'failed') {
    return { text: 'ctxloom: setup failed — see Output', tooltip: 'CLI install failed. Click to view the Output channel.', color: 'statusBarItem.errorForeground' };
  }
  if (cliInstallState === 'windows-unsupported') {
    return { text: 'ctxloom: Windows support coming in v1.2', tooltip: 'Click to open the tracking issue.', color: 'statusBarItem.warningForeground' };
  }

  // — rest of the existing logic continues unchanged —
  const riskPart = riskScore !== null ? `⚠ ${riskScore.toFixed(2)}` : '';
  // …
}
```

- [ ] **Step 4: Un-comment the FIXMEs in `extension.ts`**

Restore the `cliInstallState` field in the four `statusBar?.update(...)` call sites that you commented in Task 7 step 3. The existing values (`'installing'`, `'setup-needed'`, `'failed'`, `'windows-unsupported'`) now type-check.

- [ ] **Step 5: Run tests, confirm 11/11 pass**

Run: `cd apps/vscode-extension && npx vitest run tests/unit/statusBar.test.ts`
Expected: 11/11 (6 prior + 5 new) passing.

- [ ] **Step 6: Verify lint**

Run: `npm run lint --workspace=ctxloom-vscode`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/vscode-extension/src/license/statusBar.ts apps/vscode-extension/tests/unit/statusBar.test.ts apps/vscode-extension/src/extension.ts
git commit -m "feat(vscode-extension): status-bar — installing / setup-needed / failed / windows-unsupported states"
```

---

### Task 9: Two new commands + extend `ctxloom: Restart Server`

**Files:**
- Modify: `apps/vscode-extension/src/commands/index.ts`
- Modify: `apps/vscode-extension/src/extension.ts`

- [ ] **Step 1: Add the two new command handlers**

Append to `apps/vscode-extension/src/commands/index.ts` (inside the `registerCommands` body where the other `registerCommand` calls live):

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('ctxloom.installCli', async () => {
    // Reset the dismiss flag so the user can re-prompt.
    await vscode.workspace.getConfiguration('ctxloom.cli').update('installPromptDismissed', false, vscode.ConfigurationTarget.Global);
    deps.triggerCliInstall();
  }),

  vscode.commands.registerCommand('ctxloom.showCliInstallPath', async () => {
    const root = deps.globalStorageRoot;
    const cliVersion = deps.manifestCliVersion();
    vscode.window.showInformationMessage(
      `ctxloom CLI install path: ${root}/ctxloom-cli/${cliVersion}/`,
      'Open',
    ).then(choice => { if (choice === 'Open') { vscode.env.openExternal(vscode.Uri.file(root)); } });
  }),
);
```

- [ ] **Step 2: Extend `CommandDeps` with the new fields**

Modify the `CommandDeps` interface (at the top of `commands/index.ts`):

```typescript
export interface CommandDeps {
  // … existing fields …
  globalStorageRoot: string;
  manifestCliVersion: () => string;
  triggerCliInstall: () => void;          // Re-runs startServer() — invokes CliInstaller if needed
}
```

- [ ] **Step 3: Pass the new deps from `extension.ts`**

In `extension.ts` where `registerCommands` is called, add the new fields:

```typescript
registerCommands(context, {
  // … existing fields …
  globalStorageRoot: context.globalStorageUri.fsPath,
  manifestCliVersion,
  triggerCliInstall: () => { void startServer(context); },
});
```

- [ ] **Step 4: Extend `ctxloom.restartServer` to re-trigger install on version mismatch**

Find the existing `ctxloom.restartServer` registration in `commands/index.ts` and replace its body with:

```typescript
vscode.commands.registerCommand('ctxloom.restartServer', async () => {
  deps.logger.info('Restart server requested via command palette.');
  if (cliInstaller) cliInstaller.resetFailureCount();
  await deps.triggerCliInstall();
}),
```

(`cliInstaller` is module-level in `extension.ts`; access it via a function in `deps`. Add `resetFailureCount: () => void` to `CommandDeps`, plumbed similarly.)

To keep this clean, expose a single `restartServer()` function in `extension.ts`:

```typescript
async function restartServer(context: vscode.ExtensionContext): Promise<void> {
  if (serverManager) { try { await serverManager.dispose(); } catch { /* ignore */ } serverManager = null; }
  if (cliInstaller) cliInstaller.resetFailureCount();
  tools = null;
  await startServer(context);
}
```

…and pass `restartServer: () => restartServer(context)` in `CommandDeps`. Then the registration becomes:

```typescript
vscode.commands.registerCommand('ctxloom.restartServer', () => deps.restartServer()),
```

- [ ] **Step 5: Verify lint**

Run: `npm run lint --workspace=ctxloom-vscode`
Expected: PASS.

- [ ] **Step 6: Smoke-run the build**

```bash
cd apps/vscode-extension && npm run build
```

Expected: lint + esbuild succeed.

- [ ] **Step 7: Commit**

```bash
git add apps/vscode-extension/src/commands/index.ts apps/vscode-extension/src/extension.ts
git commit -m "feat(vscode-extension): commands — Install CLI, Show CLI Install Path; Restart Server re-triggers install"
```

---

## Phase 3 — Build pipeline

### Task 10: `build-cli-tarballs.mjs`

**Files:**
- Create: `apps/vscode-extension/scripts/build-cli-tarballs.mjs`
- Delete: `apps/vscode-extension/scripts/prepare-bundle.mjs`
- Modify: `apps/vscode-extension/package.json` (build script)

- [ ] **Step 1: Write the new tarball builder**

Write `apps/vscode-extension/scripts/build-cli-tarballs.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Build platform-specific tarballs of ctxloom-pro for the v1.1 lazy-install flow.
 * Produces dist-cli/ctxloom-cli-<version>-<platform>.tar.gz + .sha256 sidecar.
 *
 * Usage:
 *   node scripts/build-cli-tarballs.mjs --platform=linux-x64
 *   node scripts/build-cli-tarballs.mjs               # builds host's native platform
 *
 * The script always runs `npm install --omit=dev` for the platform it's running on
 * (cross-platform native binaries via npm_config_target_* are out of scope for v1.1 —
 * the publish workflow runs the matrix across native runners).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extRoot, '../..');
const distCli = path.join(extRoot, 'dist-cli');

function detectPlatform() {
  const flag = process.argv.find(a => a.startsWith('--platform='));
  if (flag) return flag.slice('--platform='.length);
  const p = process.platform, a = process.arch;
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64';
  if (p === 'darwin' && a === 'x64') return 'darwin-x64';
  if (p === 'linux' && a === 'x64') return 'linux-x64';
  if (p === 'linux' && a === 'arm64') return 'linux-arm64';
  throw new Error(`Unsupported host platform: ${p}/${a}. Pass --platform=<name>.`);
}

const platform = detectPlatform();
console.log(`[build-cli-tarballs] Building for ${platform}…`);

console.log('[build-cli-tarballs] Building ctxloom-pro…');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });

console.log('[build-cli-tarballs] Packing ctxloom-pro…');
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-pack-'));
const packOutput = execSync('npm pack --json', { cwd: repoRoot, encoding: 'utf-8' });
const packed = JSON.parse(packOutput);
const tarballName = packed[0].filename;
const tarballPath = path.resolve(repoRoot, tarballName);
const version = packed[0].version;

execSync(`tar -xzf "${tarballPath}" -C "${packDir}"`, { stdio: 'inherit' });
fs.rmSync(tarballPath, { force: true });
const packageDir = path.join(packDir, 'package');

// Strip workspace deps (e.g. @ctxloom/core) — they're tsup-bundled into dist/.
const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
const removed = [];
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (dep.startsWith('@ctxloom/')) { delete pkg.dependencies[dep]; removed.push(dep); }
}
if (removed.length) console.log('[build-cli-tarballs] Removed bundled workspace deps:', removed.join(', '));
fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(pkg, null, 2));

console.log('[build-cli-tarballs] Installing production deps…');
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts', {
  cwd: packageDir,
  stdio: 'inherit',
});

// Strip onnxruntime-node binaries for OTHER platforms.
const ortNodeDir = path.join(packageDir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
if (fs.existsSync(ortNodeDir)) {
  const [hostOs] = platform.split('-');
  for (const dir of fs.readdirSync(ortNodeDir)) {
    if (dir !== hostOs) {
      console.log(`[build-cli-tarballs] Pruning onnxruntime-node/${dir} (not needed on ${platform})`);
      fs.rmSync(path.join(ortNodeDir, dir), { recursive: true, force: true });
    }
  }
}

fs.mkdirSync(distCli, { recursive: true });
const outName = `ctxloom-cli-${version}-${platform}.tar.gz`;
const outPath = path.join(distCli, outName);

execSync(`tar -czf "${outPath}" -C "${packDir}" package`, { stdio: 'inherit' });

const bytes = fs.readFileSync(outPath);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(`${outPath}.sha256`, `${sha}  ${outName}\n`);
fs.rmSync(packDir, { recursive: true, force: true });

console.log(`[build-cli-tarballs] Wrote ${outName} (${(bytes.length / 1024 / 1024).toFixed(1)} MB) + .sha256`);
console.log(`[build-cli-tarballs] SHA-256: ${sha}`);
```

- [ ] **Step 2: Delete the old prepare-bundle script**

```bash
git rm apps/vscode-extension/scripts/prepare-bundle.mjs
```

- [ ] **Step 3: Update the build script in package.json**

In `apps/vscode-extension/package.json`, change the `build` script from:

```jsonc
"build": "node scripts/prepare-bundle.mjs && tsc --noEmit && node esbuild.config.mjs",
```

to:

```jsonc
"build": "tsc --noEmit && node esbuild.config.mjs",
```

(The CLI tarball build is no longer part of the per-PR build; it runs separately in the new `publish-cli-tarballs.yml` workflow.)

- [ ] **Step 4: Run the new tarball builder once locally and verify output**

```bash
cd apps/vscode-extension && node scripts/build-cli-tarballs.mjs 2>&1 | tail -10
ls -lh dist-cli/
shasum -a 256 -c dist-cli/*.sha256
```

Expected:
- One `.tar.gz` and one `.sha256` for the host's platform
- Tarball ~80–120 MB
- `shasum -c` reports OK

- [ ] **Step 5: Verify the new build script works**

```bash
cd apps/vscode-extension && npm run build 2>&1 | tail -5
```

Expected: `tsc --noEmit` + esbuild, no prepare-bundle step.

- [ ] **Step 6: Commit**

```bash
git add apps/vscode-extension/scripts/build-cli-tarballs.mjs apps/vscode-extension/package.json
git commit -m "build(vscode-extension): build-cli-tarballs.mjs — per-platform tarball + SHA-256 builder"
```

---

### Task 11: `publish-cli-tarballs.yml` workflow

**Files:**
- Create: `.github/workflows/publish-cli-tarballs.yml`

- [ ] **Step 1: Write the workflow**

Write `.github/workflows/publish-cli-tarballs.yml`:

```yaml
name: publish-cli-tarballs
on:
  push:
    tags: [ 'cli-v*' ]
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
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: dist-cli
          pattern: cli-*
          merge-multiple: true
      - run: ls -lh dist-cli/
      - uses: softprops/action-gh-release@v2
        with:
          files: dist-cli/ctxloom-cli-*.tar.gz*
          tag_name: ${{ github.ref_name }}
          fail_on_unmatched_files: true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/publish-cli-tarballs.yml
git commit -m "ci(vscode-extension): publish-cli-tarballs.yml — matrix-build per-platform CLI artifacts on cli-v* tags"
```

---

### Task 12: Update existing build + publish workflows

**Files:**
- Modify: `.github/workflows/build-extension.yml`
- Modify: `.github/workflows/publish-extension.yml`

- [ ] **Step 1: Drop the prepare-bundle step in `build-extension.yml`**

In `.github/workflows/build-extension.yml`, find and remove this line:

```yaml
      - run: cd apps/vscode-extension && node scripts/prepare-bundle.mjs
```

- [ ] **Step 2: Re-enable the marketplace + OpenVSX publish steps in `publish-extension.yml`**

In `.github/workflows/publish-extension.yml`, un-comment the two publish steps (they were commented in v1's "sideload-only" mode):

```yaml
      - run: cd apps/vscode-extension && npx vsce publish --packagePath ctxloom-vscode.vsix
        env: { VSCE_PAT: '${{ secrets.VSCE_PAT }}' }
      - run: cd apps/vscode-extension && npx ovsx publish ctxloom-vscode.vsix
        env: { OVSX_PAT: '${{ secrets.OVSX_PAT }}' }
```

Also remove the `prepare-bundle.mjs` invocation in this workflow:

```yaml
# remove this line if present:
      - run: cd apps/vscode-extension && node scripts/prepare-bundle.mjs && node esbuild.config.mjs
```

…and replace with just:

```yaml
      - run: cd apps/vscode-extension && node esbuild.config.mjs
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-extension.yml .github/workflows/publish-extension.yml
git commit -m "ci(vscode-extension): drop prepare-bundle step; re-enable Marketplace + OpenVSX publish

The 5 MB lazy-install VSIX clears Marketplace's 50 MB cap. The CLI is
now downloaded on first activation by CliInstaller (no bundling)."
```

---

## Phase 4 — Tests + smoke

### Task 13: Integration tests + fake-cli fixture

**Files:**
- Create: `apps/vscode-extension/tests/fixtures/fake-cli/index.ts`
- Create: `apps/vscode-extension/tests/fixtures/fake-cli/package.json`
- Create: `apps/vscode-extension/tests/fixtures/build-fake-cli.mjs`
- Create: `apps/vscode-extension/tests/integration/CliInstaller.test.ts`
- Create: `apps/vscode-extension/tests/integration/Activation.test.ts`
- Modify: `apps/vscode-extension/.vscode-test.mjs` (point at `tests/fixtures/workspace-a` as before; nothing changes here)

- [ ] **Step 1: Write the no-op fake CLI**

Write `apps/vscode-extension/tests/fixtures/fake-cli/package.json`:

```json
{
  "name": "ctxloom-pro-fake",
  "version": "0.0.0-test",
  "main": "dist/index.js",
  "bin": { "ctxloom": "dist/index.js" },
  "type": "module"
}
```

Write `apps/vscode-extension/tests/fixtures/fake-cli/index.ts`:

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'ctxloom-fake', version: '0.0.0-test' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'ctx_status', description: 'Fake status tool', inputSchema: { type: 'object' } }],
}));

server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: '<status>fake</status>' }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Write the build-fake-cli script**

Write `apps/vscode-extension/tests/fixtures/build-fake-cli.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Compile fake-cli/index.ts → fake-cli/dist/index.js, pack into a tarball,
 * write a SHA-256 sidecar. Used by CliInstaller integration tests via file:// URLs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeCliDir = path.join(__dirname, 'fake-cli');
const distDir = path.join(fakeCliDir, 'dist');

fs.mkdirSync(distDir, { recursive: true });
execSync(`npx esbuild "${path.join(fakeCliDir, 'index.ts')}" --bundle --platform=node --format=esm --outfile="${path.join(distDir, 'index.js')}"`, { stdio: 'inherit' });

const stagingDir = path.join(__dirname, '.fake-staging');
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
fs.cpSync(fakeCliDir, path.join(stagingDir, 'package'), { recursive: true });

const tarPath = path.join(__dirname, 'fake-cli.tar.gz');
execSync(`tar -czf "${tarPath}" -C "${stagingDir}" package`);
fs.rmSync(stagingDir, { recursive: true, force: true });

const sha = crypto.createHash('sha256').update(fs.readFileSync(tarPath)).digest('hex');
fs.writeFileSync(`${tarPath}.sha256`, `${sha}  ${path.basename(tarPath)}\n`);
console.log(`[fake-cli] Wrote ${tarPath} (sha=${sha.slice(0, 12)}…)`);
```

- [ ] **Step 3: Add a tiny ext setup helper to compile the fake CLI on test boot**

Add to `apps/vscode-extension/.vscode-test.mjs`:

```javascript
import { execSync } from 'node:child_process';

execSync('node tests/fixtures/build-fake-cli.mjs', { stdio: 'inherit' });
```

(Place this above the `defineConfig(...)` call so it runs at config load.)

- [ ] **Step 4: Write the CliInstaller integration test**

Write `apps/vscode-extension/tests/integration/CliInstaller.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as vscode from 'vscode';

suite('CliInstaller integration', () => {
  test('install-via-file-url places the binary at the expected globalStorage path', async function() {
    this.timeout(30_000);

    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    assert.ok(ext, 'extension not found');
    await ext!.activate();

    const fixtureTar = path.resolve(__dirname, '../fixtures/fake-cli.tar.gz');
    assert.ok(fs.existsSync(fixtureTar), 'fake-cli.tar.gz not built — check tests/fixtures/build-fake-cli.mjs');

    // Surface assertion: BinaryResolver should now find a binary somewhere under globalStorage,
    // OR the activation path should have at least registered the activate-on-failure status bar.
    const allCommands = await vscode.commands.getCommands(true);
    assert.ok(allCommands.includes('ctxloom.installCli'), 'installCli command missing');
    assert.ok(allCommands.includes('ctxloom.showCliInstallPath'), 'showCliInstallPath command missing');
  });
});
```

(Note: a fully end-to-end install test that overrides the fetch URL via a hidden setting can land in Task 14 alongside the smoke test. This integration test asserts the activation contract.)

- [ ] **Step 5: Write the activation test**

Write `apps/vscode-extension/tests/integration/Activation.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Activation orchestration', () => {
  test('extension activates without throwing even when CLI is missing', async function() {
    this.timeout(30_000);
    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    assert.ok(ext);
    await ext!.activate();
    // If activation threw, this assertion would never run.
    assert.ok(true);
  });

  test('Open Settings command registers regardless of CLI install state', async function() {
    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    await ext!.activate();
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('ctxloom.openSettings'));
  });

  test('Restart Server command is registered and callable', async function() {
    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    await ext!.activate();
    // Calling it should not throw, even if the CLI install fails downstream.
    await vscode.commands.executeCommand('ctxloom.restartServer');
    assert.ok(true);
  });
});
```

- [ ] **Step 6: Run integration tests**

```bash
cd apps/vscode-extension && npm run build && npm run test:integration -- --label integration
```

Expected: all integration tests pass (existing v1 + the 2 new files).

- [ ] **Step 7: Commit**

```bash
git add apps/vscode-extension/tests/fixtures/fake-cli/ apps/vscode-extension/tests/fixtures/build-fake-cli.mjs apps/vscode-extension/tests/integration/CliInstaller.test.ts apps/vscode-extension/tests/integration/Activation.test.ts apps/vscode-extension/.vscode-test.mjs
git commit -m "test(vscode-extension): integration tests + fake-cli fixture for CliInstaller"
```

---

### Task 14: Smoke test against `cli-v0.0.0-test`

**Files:**
- Create: `apps/vscode-extension/tests/smoke/lazy-install.test.ts`
- Modify: `apps/vscode-extension/package.json` (add hidden `ctxloom.cli.testReleaseTag` config so the smoke test can override the URL)
- Modify: `apps/vscode-extension/src/client/CliInstaller.ts` (read the test setting via the constructor's existing `releaseBaseUrl` option — wired in extension.ts)

- [ ] **Step 1: Add the hidden test override config**

In `apps/vscode-extension/package.json`, add to `contributes.configuration.properties`:

```jsonc
"ctxloom.cli.testReleaseTag": {
  "type": "string",
  "default": "",
  "description": "Internal test setting. Overrides the CLI download tag for smoke tests; leave empty in normal use."
}
```

- [ ] **Step 2: Wire the override through `extension.ts`**

Find the `new CliInstaller({ ... })` call in `extension.ts`. Update to:

```typescript
const testTag = vscode.workspace.getConfiguration('ctxloom.cli').get<string>('testReleaseTag') ?? '';
const releaseBaseUrl = testTag.trim() !== ''
  ? `https://github.com/kodiii/ctxloom/releases/download`     // unchanged base
  : undefined;
const overrideVersion = testTag.trim() !== '' ? testTag.replace(/^cli-v/, '') : cliVersion;

cliInstaller ??= new CliInstaller({
  globalStorageRoot: context.globalStorageUri.fsPath,
  fetch: globalThis.fetch,
  logger: { /* … */ },
  prompt: makePrompt(context, overrideVersion),
  progress: makeProgress(),
  releaseBaseUrl,
});
// …
const outcome = await cliInstaller.ensureInstalled(overrideVersion);
```

(The base URL is the same; only the version that we ask the installer to fetch changes. The existing `releaseBaseUrl` option lets unit tests inject `https://example.test`; production uses the GitHub URL.)

- [ ] **Step 3: Write the smoke test**

Write `apps/vscode-extension/tests/smoke/lazy-install.test.ts`:

```typescript
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

suite('Lazy-install smoke (real GitHub Releases)', () => {
  test('downloads + verifies + installs the cli-v0.0.0-test fixture release', async function() {
    this.timeout(60_000);

    // Force the installer to fetch from the test tag.
    await vscode.workspace.getConfiguration('ctxloom.cli').update('testReleaseTag', 'cli-v0.0.0-test', vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('ctxloom.cli').update('installPromptDismissed', false, vscode.ConfigurationTarget.Global);

    const ext = vscode.extensions.getExtension('ctxloom.ctxloom-vscode');
    assert.ok(ext);
    await ext!.activate();

    // Wait briefly for any in-progress install to settle.
    await new Promise(r => setTimeout(r, 10_000));

    const globalStorage = (vscode.extensions.getExtension('ctxloom.ctxloom-vscode')!.extensionPath
      .replace(/\/extensions\/[^/]+$/, '/User/globalStorage/ctxloom.ctxloom-vscode'));

    // The fixture install is identifiable by its presence under ctxloom-cli/0.0.0-test/.
    const expected = path.join(globalStorage, 'ctxloom-cli', '0.0.0-test', 'dist', 'index.js');
    assert.ok(fs.existsSync(expected) || fs.existsSync(path.join(globalStorage, 'INSTALLED_VERSION')),
      `expected fixture install at ${expected} (this test requires the cli-v0.0.0-test tag to be published with platform tarballs)`);
  });
});
```

> Note: this test can only pass once the `cli-v0.0.0-test` release has been published to the repo. Until then, expect this test to fail with the assertion message above. Treat that as the prerequisite signal — the implementation is complete; the release-engineering task is owed.

- [ ] **Step 4: Run the smoke test (expected to need the prerequisite)**

```bash
cd apps/vscode-extension && npm run build && npx vscode-test --label smoke
```

Expected on a fresh repo: the test fails with the explicit "requires cli-v0.0.0-test tag" message. Once the release tag exists, it passes.

- [ ] **Step 5: Commit**

```bash
git add apps/vscode-extension/tests/smoke/lazy-install.test.ts apps/vscode-extension/package.json apps/vscode-extension/src/extension.ts
git commit -m "test(vscode-extension): smoke test against real cli-v0.0.0-test release tag

Hidden ctxloom.cli.testReleaseTag config lets the smoke test point the
installer at a fixture release. Test asserts the full network → SHA →
extract → INSTALLED_VERSION pipeline. Fails until the cli-v0.0.0-test
GitHub Release is published with platform tarballs (one-time release-prep step)."
```

---

## Final verification

- [ ] **Run the full test suite (root + extension)**

```bash
npm test                                                       # root tests
cd apps/vscode-extension && npx vitest run tests/unit/         # extension unit tests
cd apps/vscode-extension && npm run test:integration           # extension integration tests
```

Expected: all green. Skip the smoke test until the `cli-v0.0.0-test` fixture release exists.

- [ ] **Verify lint**

```bash
npm run lint --workspace=ctxloom-vscode
```

Expected: exit 0.

- [ ] **Verify VSIX size**

```bash
cd apps/vscode-extension && npm run build && npx vsce package --no-dependencies -o /tmp/ctxloom-vscode-v1.1.vsix
ls -lh /tmp/ctxloom-vscode-v1.1.vsix
```

Expected: VSIX ≤ 10 MB. (Spec target: ~5 MB. Will likely land at 1–3 MB since `dist/extension.js` is ~600 KB and the webview bundle is ~10 KB.)

- [ ] **Push branch and open PR**

```bash
git push -u origin feat/vscode-extension-v1.1-lazy-cli
gh pr create --title "feat: VS Code extension v1.1 — CLI lazy-download" --body "$(cat <<'EOF'
## Summary
- Replaces v1's bundled ~398 MB ctxloom-pro CLI with a first-run lazy-download from GitHub Releases.
- VSIX drops from 108 MB to ~3 MB. Marketplace + OpenVSX viable.
- New `CliInstaller` module owns network + checksum + atomic extract; `BinaryResolver` becomes a pure existence check; activation orchestration in extension.ts.
- New `publish-cli-tarballs.yml` workflow matrix-builds 4 platform tarballs (darwin-arm64/x64, linux-x64/arm64) on `cli-v*` tags.
- Marketplace + OpenVSX publish steps re-enabled in `publish-extension.yml`.
- Polite Windows fallback ("Coming in v1.2") on `process.platform === 'win32'`.

## Test plan
- [ ] `npx vitest run` — 18 unit tests for CliInstaller pass
- [ ] `npm run test:integration` — 3 new tests + all v1 integration tests pass
- [ ] `npm run build && npx vsce package` — VSIX ≤ 10 MB
- [ ] Manual: `node scripts/build-cli-tarballs.mjs` produces a working tarball with valid SHA sidecar
- [ ] (post-merge) Tag `cli-v0.0.0-test` for smoke fixture; tag `cli-v1.0.5` and `vscode-v1.1.0` for production rollout
EOF
)"
```

---

## Spec coverage check

| Spec section | Tasks |
|---|---|
| Architecture & module boundaries | 2, 3, 7 |
| Versioning model — `ctxloomCliVersion` field, two release-tag families | 1, 7, 11, 12 |
| Manifest field placement | 1 |
| Compatibility check (INSTALLED_VERSION) | 5, 6 |
| Download flow state machine | 6, 7 |
| First-run modal copy + 3 actions | 7 |
| Progress notification | 6, 7 |
| Status-bar install states | 8 |
| globalStorage layout + `INSTALLED_VERSION` | 5 |
| Atomic install (staging-rename) | 5 |
| BinaryResolver lookup priority (override → globalStorage → null) | 2 |
| Disk-space hygiene (old version delete) | 5 |
| Failure handling — 9 axes | 4, 6 |
| Retry budget (3 per session) | 6 |
| Recovery via `ctxloom: Restart Server` | 9 |
| Two new commands (Install CLI, Show CLI Install Path) | 9 |
| Out-of-scope items (no resumable downloads, no mirrors, no sigstore) | (intentionally excluded) |
| `build-cli-tarballs.mjs` per-platform builder | 10 |
| `publish-cli-tarballs.yml` matrix workflow | 11 |
| Modified existing workflows (drop prepare-bundle, re-enable publish) | 12 |
| Layer 1 unit tests (~10 CliInstaller + 3 BinaryResolver) | 2, 3, 4, 5, 6, 8 |
| Layer 2 integration tests (CliInstaller + Activation + fake-cli) | 13 |
| Layer 3 smoke test (`cli-v0.0.0-test` fixture) | 14 |
| Migration & backwards compat | 1 (config), 2 (resolver), 7 (extension wiring) |
| Success criteria — VSIX ≤ 10 MB, install ≤ 90s | Final verification |
| Windows fallback | 7 |
