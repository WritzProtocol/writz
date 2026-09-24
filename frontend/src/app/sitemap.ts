import type { MetadataRoute } from "next";
import { env } from "@/config/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: new URL("/", env.siteUrl).toString(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: new URL("/brand", env.siteUrl).toString(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
