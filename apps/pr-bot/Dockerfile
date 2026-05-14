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

# Install all workspace deps. pr-bot's bundle leaves @ctxloom/core's
# heavy transitive deps (huggingface/transformers, lancedb, tree-sitter,
# etc.) external — they must be present in node_modules at runtime even
# though pr-bot itself never calls them, because static imports in the
# core graph trigger module resolution before any user code runs.
# `--ignore-scripts` skips the root `postinstall` (which calls
# dist/setup/postinstall.js — a file only present after the root CLI's
# tsup build, which we don't need to do here).
RUN npm ci --ignore-scripts

# tsup-bundle the pr-bot entrypoint. @ctxloom/core is inlined; the
# heavy native deps stay external and are resolved from node_modules
# at runtime.
RUN npm run build -w @ctxloom/pr-bot

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /action

ENV NODE_ENV=production

# The Action surface: bundled entrypoint + the runtime deps tsup marked
# external. npm hoists workspace deps to /app/node_modules at the root,
# so we copy that whole tree — it contains everything tsup left as
# `require("@huggingface/transformers")` etc.
COPY --from=builder /app/apps/pr-bot/dist/ ./dist/
COPY --from=builder /app/apps/pr-bot/package.json ./package.json
COPY --from=builder /app/node_modules/ ./node_modules/

# GitHub injects the event payload, workspace path, and token at run
# time. The entrypoint reads them via env and posts comments via the
# GitHub API.
ENTRYPOINT ["node", "/action/dist/index.js"]
