# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Workspace metadata + lockfile (needed for `npm ci` to resolve the workspace
# graph deterministically).
COPY package.json package-lock.json* tsconfig.json ./

# pr-bot depends on @ctxloom/core via the npm workspace, so we need core's
# source available when tsup bundles it in (noExternal: ['@ctxloom/core']).
COPY packages/core/ packages/core/
COPY apps/pr-bot/ apps/pr-bot/

# Install hoisted workspace dependencies. We don't need the dashboard or
# any other app, only what pr-bot's tree references.
RUN npm ci --workspaces=false --include-workspace-root \
 && npm ci -w @ctxloom/pr-bot

# Build the pr-bot bundle. tsup inlines @ctxloom/core, so the resulting
# dist/index.js is self-contained relative to runtime deps in node_modules.
RUN npm run build -w @ctxloom/pr-bot

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV CTXLOOM_CACHE_DIR=/var/lib/ctxloom-bot

# Copy the bundled artifact and just the runtime deps that pr-bot's tsup
# config marked external. The image stays slim because we don't ship the
# dashboard, the CLI, source maps for ML stacks, etc.
COPY --from=builder /app/apps/pr-bot/dist/ ./dist/
COPY --from=builder /app/apps/pr-bot/package.json ./package.json
COPY --from=builder /app/apps/pr-bot/node_modules/ ./node_modules/

# Persistent volume for graph cache + analysis state.
VOLUME /var/lib/ctxloom-bot
EXPOSE 3000

# Local health probe — matches the http_service check in fly.toml so
# `docker run` users (and any non-Fly orchestrator) get the same signal
# Fly already has. Uses `node --eval` to avoid needing curl/wget in the
# slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node --eval "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
