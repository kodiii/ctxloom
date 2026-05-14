# ─── Build stage ──────────────────────────────────────────────────────────────
# This image is the runtime for the ctxloom GitHub Action. It is built
# from the monorepo root so the workspace graph (packages/core +
# apps/pr-bot) resolves correctly.
FROM node:22-slim AS builder

WORKDIR /app

# Workspace metadata + lockfile.
COPY package.json package-lock.json* tsconfig.json ./
COPY packages/core/ packages/core/
COPY apps/pr-bot/ apps/pr-bot/

# Install only what pr-bot's bundle actually requires at runtime.
# `@ctxloom/core` now lazy-loads its heavy native deps (huggingface,
# lancedb, web-tree-sitter) so they're absent from pr-bot's bundle —
# we don't need to ship them in the image. `--ignore-scripts` skips
# the root `postinstall` (which calls dist/setup/postinstall.js — a
# file only present after the root CLI build).
#
# We need to install both the workspace's direct deps AND the root
# package's deps (workspace resolution requires the lockfile to be
# materialized at the root). `--include-workspace-root -w @ctxloom/pr-bot`
# does both in a single pass.
RUN npm ci --ignore-scripts --include-workspace-root -w @ctxloom/pr-bot

# tsup-bundle the pr-bot entrypoint. @ctxloom/core is inlined; the
# heavy native deps stay external and are resolved from node_modules
# at runtime.
RUN npm run build -w @ctxloom/pr-bot

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-slim

# Install git + ca-certificates. node:22-slim ships without git, but
# `simple-git` (used by @ctxloom/core's GitOverlayStore for co-change
# history) spawns `git` as a subprocess. Without this the action
# crashes on every invocation with `spawn git ENOENT`.
# ca-certificates is needed for any future https traffic the action
# might do directly (Sentry, etc.) since slim trims the CA bundle.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /action

ENV NODE_ENV=production

# The Action surface: bundled entrypoint + the slim runtime deps tsup
# marked external (octokit, yaml, zod, graphology, simple-git). Heavy
# native modules are NOT copied — they aren't referenced by the bundle.
# npm hoists workspace deps to /app/node_modules, so we copy from
# there rather than from apps/pr-bot/node_modules.
COPY --from=builder /app/apps/pr-bot/dist/ ./dist/
COPY --from=builder /app/apps/pr-bot/package.json ./package.json
COPY --from=builder /app/node_modules/ ./node_modules/

# GitHub injects the event payload, workspace path, and token at run
# time. The entrypoint reads them via env and posts comments via the
# GitHub API.
ENTRYPOINT ["node", "/action/dist/index.js"]
