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

# Install just what pr-bot needs; the dashboard and root CLI are
# unused at action runtime. `--ignore-scripts` skips the root
# `postinstall` (which calls dist/setup/postinstall.js — a file that
# only exists after the root CLI is built, which we don't need to do).
RUN npm ci --workspaces=false --include-workspace-root --ignore-scripts \
 && npm ci -w @ctxloom/pr-bot --ignore-scripts

# tsup-bundle the pr-bot entrypoint. @ctxloom/core is inlined; the
# heavy native deps stay external and are resolved from node_modules
# at runtime.
RUN npm run build -w @ctxloom/pr-bot

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /action

ENV NODE_ENV=production

# The Action surface: bundled entrypoint + the runtime deps tsup marked
# external (octokit, simple-git, tree-sitter, graphology, etc.).
COPY --from=builder /app/apps/pr-bot/dist/ ./dist/
COPY --from=builder /app/apps/pr-bot/package.json ./package.json
COPY --from=builder /app/apps/pr-bot/node_modules/ ./node_modules/

# GitHub injects the event payload, workspace path, and token at run
# time. The entrypoint reads them via env and posts comments via the
# GitHub API.
ENTRYPOINT ["node", "/action/dist/index.js"]
