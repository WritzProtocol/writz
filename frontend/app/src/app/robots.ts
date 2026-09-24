import type { MetadataRoute } from "next";
import { config } from "@/config";

export default function robots(): MetadataRoute.Robots {
  if (config.target !== "mainnet") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Live on-chain state, so a crawled copy is stale the moment it is stored.
      disallow: ["/api/", "/metrics"],
    },
  };
}
