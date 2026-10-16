import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // snarkjs uses dynamic require() that webpack cannot bundle reliably.
  // Mark it as external so the Node.js runtime loads it directly at request
  // time (required for the /api/cosign serverless function).
  serverExternalPackages: ["snarkjs"],
  async redirects() {
    return [{ source: "/metrics", destination: "/protocol", permanent: true }];
  },
};

export default nextConfig;
