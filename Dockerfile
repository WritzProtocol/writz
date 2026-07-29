# syntax=docker/dockerfile:1
#
# Build from the monorepo root:
#   docker build -f Dockerfile .
#
# Bun runs the TypeScript source directly — no compile step needed.
# This lets us import ESM-only packages (commitment-tree) without
# a CJS/ESM conversion layer.

FROM oven/bun:1.3.14-alpine

WORKDIR /app

# The package.json references commitment-tree as file:../packages/commitment-tree
# WORKDIR is /app, so ../packages resolves to /packages — copy there
# and install its own dependencies first.
COPY packages/commitment-tree/ /packages/commitment-tree/
RUN cd /packages/commitment-tree && bun install

# The package.json references @writz/bitcoin-script as file:../bitcoin-script.
# WORKDIR is /app, so ../bitcoin-script resolves to /bitcoin-script — copy
# it there and build it: the repay-watcher imports its built dist/ output
# (bitcoin-script's package.json "main" field points at dist/index.js), not
# its TypeScript source, so `bun install` alone isn't enough.
COPY bitcoin-script/ /bitcoin-script/
RUN cd /bitcoin-script && bun install --frozen-lockfile && bun run build

# Relayer
COPY relayer/package.json relayer/bun.lock ./
RUN bun install --frozen-lockfile

COPY relayer/tsconfig.json ./
COPY relayer/src ./src

EXPOSE 3000

CMD ["bun", "src/index.ts"]
