# Releasing ctxloom

This checklist covers the `ctxloom-pro` npm package, GitHub release, release
workflows, and the public website. Run it from a clean checkout of `main` using
Node.js 20 or newer.

## 1. Prepare the release

1. Pull the latest `main` and confirm the worktree is clean.
2. Choose the next semantic version and update `package.json` plus the lockfile.
3. Move the relevant `CHANGELOG.md` entries from `[Unreleased]` into a dated
   version section.
4. Update version-pinned examples in `README.md` and other maintained docs.
5. If public product facts changed, update the website's
   `src/lib/product-facts.ts` in the `ctxloomAPP` repository.

Do not rewrite historical benchmark posts or release notes. Label a new result
with its release and keep the reproduction commands beside the claim.

## 2. Validate the source tree

```bash
npm ci
npm run lint
npm test
npm run build
```

When benchmark inputs or reporting changed, also run:

```bash
npm run bench:validate
npm run bench:full
```

Commit generated benchmark reports only when the methodology and corpus
preflight both pass.

## 3. Validate the package

Published builds include the PostHog write key and Sentry DSN at build time.
Set both release variables in the publishing shell without printing them:

```bash
export CTXLOOM_BUILD_POSTHOG_KEY='<PostHog project write key>'
export CTXLOOM_BUILD_SENTRY_DSN='<Sentry DSN>'
npm run smoke:publish
```

The smoke test packs and installs the exact consumer artifact, launches the
CLI and dashboard, and rejects an artifact with empty telemetry fallbacks. Use
`CTXLOOM_ALLOW_NO_TELEMETRY=1` only for an intentional private build, never for
the public package.

Before publishing, verify npm authentication and the unpublished version:

```bash
CTXLOOM_RELEASE_VERSION=$(node -p "require('./package.json').version")
npm whoami
npm view "ctxloom-pro@$CTXLOOM_RELEASE_VERSION" version
```

The second command should return an npm 404 for a new version.

## 4. Publish and release

```bash
npm publish
npm view "ctxloom-pro@$CTXLOOM_RELEASE_VERSION" version dist-tags.latest dist.shasum
```

Create an annotated `v<version>` tag at the merged release commit, push it, and
create the GitHub release from that tag. Confirm that the tag resolves to the
same commit as `origin/main` and that the tag-triggered workflows succeed:

- pr-bot mirror to the public action repository
- pr-bot container image publication
- Sentry sourcemap upload

Never move or reuse a published tag.

## 5. Verify consumers and the website

Install the public artifact in a clean environment and verify both resolution
paths:

```bash
npm install -g "ctxloom-pro@$CTXLOOM_RELEASE_VERSION"
ctxloom --version
npx -y "ctxloom-pro@$CTXLOOM_RELEASE_VERSION" --version
```

Run `ctxloom setup`, then `ctxloom init --dry-run` in an initialized project.
Verify the global MCP registration, the project-scoped `CTXLOOM_ROOT`, and the
signed agent rule files for the supported hosts.

After the website change deploys, check:

- `https://www.ctxloom.com/` returns HTTP 200 and exposes the new version.
- Public benchmark numbers match the committed report.
- `https://api.ctxloom.com/healthz` returns HTTP 200 with `{ "ok": true }`.

Record npm, GitHub release, workflow, and production-site evidence in the
release pull request or release notes so the next maintainer can audit it.
