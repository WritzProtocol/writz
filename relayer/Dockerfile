# syntax=docker/dockerfile:1
#
# Build from the monorepo root:
#   docker build -f relayer/Dockerfile .
#
# Bun runs the TypeScript source directly — no compile step needed.
# This lets us import ESM-only packages (commitment-tree) without
# a CJS/ESM conversion layer.

FROM oven/bun:1-alpine

WORKDIR /app

# Shared monorepo packages (commitment-tree)
COPY packages/ ./packages/

# Relayer
COPY relayer/package.json relayer/bun.lock ./
RUN bun install --frozen-lockfile

COPY relayer/tsconfig.json ./
COPY relayer/src ./src

# Mount a persistent volume at /app/data to survive container restarts:
#   docker run -v writz-merkle-data:/app/data ...
# Without a volume the leaf store resets on every restart.
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["bun", "src/index.ts"]
