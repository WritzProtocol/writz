# syntax=docker/dockerfile:1
#
# Build from the monorepo root:
#   docker build -f Dockerfile .
#
# Bun runs the TypeScript source directly - no compile step needed.
# This lets us import ESM-only packages without a CJS/ESM conversion layer.

FROM oven/bun:1.3.14-alpine

WORKDIR /app

# The package.json references @writz/bitcoin-script as file:../bitcoin-script.
# WORKDIR is /app, so ../bitcoin-script resolves to /bitcoin-script - copy
# it there and build it: the repay-watcher imports its built dist/ output
# (bitcoin-script's package.json "main" field points at dist/index.js), not
# its TypeScript source, so `bun install` alone isn't enough.
COPY bitcoin-script/ /bitcoin-script/
RUN cd /bitcoin-script && bun install --frozen-lockfile && bun run build

# The package.json references writz-lend as file:../packages/writz-lend,
# the writz-lend bindings generated from the contract (#259). Bun resolves it
# to that folder at runtime, so it needs its own dependencies installed there.
COPY packages/writz-lend/ /packages/writz-lend/
RUN cd /packages/writz-lend && bun install --frozen-lockfile

# Relayer
COPY relayer/package.json relayer/bun.lock ./
RUN bun install --frozen-lockfile

COPY relayer/tsconfig.json ./
COPY relayer/src ./src
EXPOSE 3000

CMD ["bun", "src/index.ts"]
