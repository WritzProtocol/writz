/**
 * Environment access for the landing site. The landing has a single
 * deployment and no chain config, so every value has a writz.xyz default.
 */

export function readUrl(name: string, raw: string | undefined, fallback: string): string {
  const value = raw || fallback;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} is set but is not a valid URL: "${value}"`);
  }
}

export const env = {
  siteUrl: readUrl("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL, "https://writz.xyz"),
  appUrl: readUrl("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL, "https://testnet.writz.xyz"),
  umamiWebsiteId: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? "",
} as const;
