import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // snarkjs uses dynamic require() that webpack cannot bundle reliably.
  // Mark it as external so the Node.js runtime loads it directly at request
  // time (required for the /api/cosign serverless function).
  serverExternalPackages: ["snarkjs"],
};

export default nextConfig;
