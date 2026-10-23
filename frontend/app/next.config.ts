import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  async redirects() {
    return [{ source: "/metrics", destination: "/protocol", permanent: true }];
  },
};

export default nextConfig;
