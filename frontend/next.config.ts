import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app so an unrelated lockfile higher up the
  // tree is not picked up as the root.
  turbopack: {
    root: path.resolve(__dirname, ".."),
    resolveAlias: {
      "commitment-tree": "../packages/commitment-tree/src/index.ts",
      // commitment-tree lives outside frontend/, so Turbopack can't traverse
      // up to frontend/node_modules/ when resolving its dependencies. Pin them
      // explicitly to the copies installed here.
      "@stellar/stellar-sdk": path.resolve(__dirname, "node_modules/@stellar/stellar-sdk"),
      "@stellar/stellar-sdk/contract": path.resolve(__dirname, "node_modules/@stellar/stellar-sdk/contract"),
      "@stellar/stellar-sdk/rpc": path.resolve(__dirname, "node_modules/@stellar/stellar-sdk/rpc"),
    },
  },
  // Transpile the generated contract bindings from source so no committed
  // build artifact (dist/) is required.
  transpilePackages: ["commitment-tree"],
  // snarkjs uses dynamic require() and native BigInt operations that webpack
  // cannot bundle reliably. Mark it as external so the Node.js runtime loads
  // it directly at request time (works for the /api/cosign serverless function).
  serverExternalPackages: ["snarkjs"],
};

export default nextConfig;
