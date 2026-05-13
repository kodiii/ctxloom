# Sentry Sourcemap Upload (PR-C, v1.1.4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Upload source maps for all three release artifacts (CLI bundle, dashboard server bundle, dashboard client bundle) to Sentry on every tag push, so Sentry events show readable stack traces instead of minified output. Sourcemaps inline the original `.ts/.tsx` contents via `sentry-cli --include-sources`, so Sentry needs no GitHub access.

**Branch:** `feat/sentry-sourcemap-upload`

**Trigger:** GitHub Actions workflow runs on `push` of tags matching `v*`. Auth via `secrets.SENTRY_AUTH_TOKEN`; org and project slugs via `vars.SENTRY_ORG` and `vars.SENTRY_PROJECT`.

---

## Repo configuration the user must set before this works

These are documented in the PR body and the workflow file's comments:

1. **Repository secret** `SENTRY_AUTH_TOKEN` — a write-scoped Sentry internal integration token with `project:releases` permission.
2. **Repository variable** `SENTRY_ORG` — Sentry organization slug (visible in any Sentry URL).
3. **Repository variable** `SENTRY_PROJECT` — Sentry project slug.

If any are unset the workflow logs an error and exits cleanly without failing the build.

---

## Phase 1: Sourcemap generation

### Task 1: Enable Vite client sourcemaps

**File:** `apps/dashboard/vite.config.ts`

Current `build` block:
```typescript
build: {
  outDir: '../dist/dashboard/client',
  emptyOutDir: true,
},
```

Add `sourcemap: true`:
```typescript
build: {
  outDir: '../dist/dashboard/client',
  emptyOutDir: true,
  sourcemap: true,
},
```

CLI and dashboard server sourcemaps are already enabled — no change needed.

**Verify:** `npm run build` produces `.map` files for all three bundles. Check:
- `dist/index.js.map` (CLI, from `tsup.config.ts`)
- `apps/dashboard/dist/server/index.js.map` (dashboard server, from `tsup.server.config.ts`)
- `apps/dashboard/dist/client/assets/*.js.map` (dashboard client, from Vite)

**Commit:** `build(dashboard): enable sourcemap generation for the Vite client bundle`

---

## Phase 2: Sentry CLI upload workflow

### Task 2: Add @sentry/cli as a devDependency

```bash
npm install --save-dev @sentry/cli
```

This pulls down the `sentry-cli` binary on `npm ci` so the GitHub Actions step can call it without a separate install.

### Task 3: Add the GitHub Actions workflow

**New file:** `.github/workflows/sentry-sourcemaps.yml`

```yaml
name: Sentry sourcemap upload

# Runs after the user publishes to npm and pushes the tag (see the release
# protocol). Builds the same artifacts that ship to users and uploads their
# sourcemaps to Sentry, tagged with the release version that matches the
# `release` property already on every Sentry event payload.
on:
  push:
    tags:
      - 'v*'

jobs:
  upload:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Extract version from tag
        id: version
        run: |
          # Tag is "v1.1.4" -> version is "1.1.4"
          version="${GITHUB_REF_NAME#v}"
          echo "version=$version" >> "$GITHUB_OUTPUT"
          echo "Detected version: $version"

      - name: Verify required Sentry config is present
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ vars.SENTRY_PROJECT }}
        run: |
          missing=()
          [ -z "$SENTRY_AUTH_TOKEN" ] && missing+=("SENTRY_AUTH_TOKEN (secret)")
          [ -z "$SENTRY_ORG" ] && missing+=("SENTRY_ORG (variable)")
          [ -z "$SENTRY_PROJECT" ] && missing+=("SENTRY_PROJECT (variable)")
          if [ ${#missing[@]} -gt 0 ]; then
            echo "::error::Sentry config missing — sourcemap upload skipped: ${missing[*]}"
            echo "Configure these in the repo Settings → Secrets and variables → Actions."
            exit 0
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build all release artifacts
        run: npm run build

      - name: Create Sentry release + upload sourcemaps
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ vars.SENTRY_PROJECT }}
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          set -euo pipefail
          npx sentry-cli releases new "$VERSION"

          # CLI bundle — runtime path looks like /Users/~/.../node_modules/ctxloom-pro/dist/index.js
          npx sentry-cli releases files "$VERSION" upload-sourcemaps \
            --include-sources \
            --url-prefix '~/dist' \
            dist/

          # Dashboard server bundle — same shape, mounted under apps/dashboard/dist/server in dev,
          # but in published tarball lives under dist/dashboard/server. Use a permissive prefix.
          if [ -d apps/dashboard/dist/server ]; then
            npx sentry-cli releases files "$VERSION" upload-sourcemaps \
              --include-sources \
              --url-prefix '~/dashboard/server' \
              apps/dashboard/dist/server/
          fi

          # Dashboard client bundle — browser fetches assets from "/assets/*"
          if [ -d apps/dashboard/dist/client ]; then
            npx sentry-cli releases files "$VERSION" upload-sourcemaps \
              --include-sources \
              --url-prefix '~/' \
              apps/dashboard/dist/client/
          fi

          npx sentry-cli releases finalize "$VERSION"
```

**Notes on the workflow:**
- The `release` name `$VERSION` (e.g. `1.1.4`) exactly matches the `tags.release` value already on every Sentry payload (set from `__CTXLOOM_VERSION__` at build time).
- `--include-sources` inlines the original `.ts/.tsx` content into the uploaded `.map` files so Sentry never needs to reach back to GitHub.
- `--url-prefix '~/...'` tells Sentry the prefix to match against incoming stack frames. The `~/` is Sentry's wildcard prefix that matches any host — important because the dashboard client runs at `http://localhost:<port>` on the user's machine.
- The "missing config" branch exits 0 (success) instead of failing the workflow, so first-time setup doesn't block a release. The error annotation is loud in the UI.

### Task 4: Document in CHANGELOG and PR body

Add the release-engineering instructions to the PR body so the user knows what repo settings to configure before the first tagged release lands.

**Commit:** `feat(release): upload sourcemaps to Sentry on tag push via GitHub Actions`

---

## Phase 3: Release

### Task 5: Bump to v1.1.4, CHANGELOG, push PR

- `package.json`: `1.1.3` → `1.1.4`
- `CHANGELOG.md`: new `[1.1.4]` section
- Run `npm test && npm run build`
- Open PR

PR body must include:

```
## Repo configuration required before this works

Add the following to repository Settings → Secrets and variables → Actions:

**Secret:**
- `SENTRY_AUTH_TOKEN` — write-scoped Sentry internal integration token with `project:releases` permission

**Variables:**
- `SENTRY_ORG` — Sentry organization slug
- `SENTRY_PROJECT` — Sentry project slug

If any are unset, the workflow logs an error annotation and exits cleanly — the tag-push CI doesn't fail.
```

**Commit:** `chore(release): bump to v1.1.4 + CHANGELOG entry for Sentry sourcemap upload`
