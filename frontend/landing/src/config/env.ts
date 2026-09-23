/**
 * Typed, validated environment access for the landing surface. Unlike
 * testnet/mainnet, landing has exactly one deployment, so there is no
 * deploy-target fallback to resolve, the default is always writz.xyz.
 */

function readSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "https://writz.xyz";
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`NEXT_PUBLIC_SITE_URL is set but is not a valid URL: "${raw}"`);
  }
}

function readAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "https://testnet.writz.xyz";
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`NEXT_PUBLIC_APP_URL is set but is not a valid URL: "${raw}"`);
  }
}

export const env = {
  siteUrl: readSiteUrl(),
  appUrl: readAppUrl(),
} as const;
