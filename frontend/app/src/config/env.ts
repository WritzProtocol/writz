/**
 * Typed, validated environment access for the marketing/landing surface.
 * The dApp's own on-chain config already lives in `@/config` - this module
 * only covers what the landing page itself needs (currently just the
 * canonical site URL used for `metadataBase`/OpenGraph resolution).
 */

import { resolveDeployTarget, TARGET_PROFILES } from "@/config/target";

function readSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) {
    // Fall back to the deploy target's own canonical origin rather than a
    // single hardcoded one. Without this, a testnet build that forgets
    // NEXT_PUBLIC_SITE_URL emits OpenGraph URLs pointing at the mainnet
    // domain - links that resolve to a different deployment, or to nothing.
    return TARGET_PROFILES[resolveDeployTarget(process.env.NEXT_PUBLIC_WRITZ_ENV)].siteUrl;
  }

  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`NEXT_PUBLIC_SITE_URL is set but is not a valid URL: "${raw}"`);
  }
}

export const env = {
  siteUrl: readSiteUrl(),
} as const;
