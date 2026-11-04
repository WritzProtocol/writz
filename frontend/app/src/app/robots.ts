import type { MetadataRoute } from "next";
import { config } from "@/config";

export default function robots(): MetadataRoute.Robots {
  if (config.target !== "mainnet") {
    // Crawlers have to fetch the page to see its noindex; a Disallow would hide it.
    return { rules: { userAgent: "*", allow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Live on-chain state, so a crawled copy is stale the moment it is stored.
      disallow: ["/api/", "/protocol"],
    },
  };
}
