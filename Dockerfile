# syntax=docker/dockerfile:1

# ---- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# pnpm via corepack (version pinned by packageManager/lockfile).
RUN corepack enable

# Install dependencies first so this layer caches across source changes.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# Drop dev dependencies so only runtime deps are copied forward.
RUN pnpm prune --prod


# ---- Runtime stage -----------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Run as a non-root user. The node image ships an unprivileged `node` user.
RUN apk add --no-cache curl
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

EXPOSE 3000

# The orchestrator restarts the container if /health stops answering.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

# Exec form so Node is PID 1 and receives SIGTERM directly, which lets Nest's
# shutdown hooks drain in-flight requests instead of being killed.
CMD ["node", "dist/main.js"]
