/**
 * Typed, validated environment access for the marketing/landing surface.
 * The dApp's own on-chain config already lives in `@/config` — this module
 * only covers what the landing page itself needs (currently just the
 * canonical site URL used for `metadataBase`/OpenGraph resolution).
 */

function readSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return "https://writz.xyz";

  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`NEXT_PUBLIC_SITE_URL is set but is not a valid URL: "${raw}"`);
  }
}

export const env = {
  siteUrl: readSiteUrl(),
} as const;
