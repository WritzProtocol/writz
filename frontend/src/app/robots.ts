import type { MetadataRoute } from "next";
import { env } from "@/config/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The dApp and the metrics dashboard render live on-chain state at
      // request time, so a crawled copy is stale the moment it is stored.
      disallow: ["/api/", "/app", "/metrics"],
    },
    sitemap: new URL("/sitemap.xml", env.siteUrl).toString(),
  };
}
