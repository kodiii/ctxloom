# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20 AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json* ./

# Copy the workspace app and root source that @ctxloom/pr-bot depends on
COPY apps/pr-bot/ apps/pr-bot/
COPY src/ src/
COPY tsconfig.json ./

# Install all workspace dependencies (hoisted at root)
RUN npm ci

# Build the root ctxloom package first (pr-bot depends on it)
RUN npm run build

# Build the pr-bot workspace package
RUN npm run build -w @ctxloom/pr-bot

# ─── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Copy entire workspace structure with built artifacts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json* ./
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/apps/pr-bot/dist/ apps/pr-bot/dist/
COPY --from=builder /app/apps/pr-bot/package.json apps/pr-bot/package.json
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/apps/pr-bot/node_modules/ apps/pr-bot/node_modules/

# Persistent volume for graph cache and analysis data
VOLUME /var/lib/ctxloom-bot

ENV CTXLOOM_CACHE_DIR=/var/lib/ctxloom-bot
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "apps/pr-bot/dist/index.js"]
