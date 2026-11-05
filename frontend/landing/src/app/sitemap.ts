import type { MetadataRoute } from "next";
import { env } from "@/config/env";

const PAGES = [
  { path: "/", lastModified: "2026-11-03" },
  { path: "/whitepaper", lastModified: "2026-11-03" },
  { path: "/brand", lastModified: "2026-11-03" },
  { path: "/about", lastModified: "2026-11-04" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, lastModified }) => ({
    url: new URL(path, env.siteUrl).toString(),
    lastModified,
  }));
}
