import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // snarkjs uses dynamic require() that webpack cannot bundle reliably.
  // Mark it as external so the Node.js runtime loads it directly at request
  // time (required for the /api/cosign serverless function).
  serverExternalPackages: ["snarkjs"],
  devIndicators: process.env.NEXT_PUBLIC_UI_MOCK === "1" ? false : undefined,
};

export default nextConfig;
