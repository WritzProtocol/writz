import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app so an unrelated lockfile higher up the
  // tree is not picked up as the root.
  turbopack: {
    root: path.resolve(),
  },
  // Transpile the generated contract bindings from source so no committed
  // build artifact (dist/) is required.
  transpilePackages: ["commitment-tree"],
};

export default nextConfig;
