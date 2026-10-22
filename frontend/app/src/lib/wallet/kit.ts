import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { config } from "@/config";

// The kit writes these onto <html> as --swk-* properties, so they resolve against the shared brand tokens.
const WRITZ_WALLET_THEME = {
  background: "var(--surface)",
  "background-secondary": "var(--surface-2)",
  "foreground-strong": "var(--heading)",
  foreground: "var(--heading)",
  "foreground-secondary": "var(--body)",
  primary: "var(--accent)",
  "primary-foreground": "var(--on-accent)",
  transparent: "rgba(0, 0, 0, 0)",
  lighter: "var(--surface-2)",
  light: "var(--surface)",
  "light-gray": "var(--muted)",
  gray: "var(--muted)",
  danger: "var(--danger)",
  border: "var(--line-strong)",
  shadow: "0 16px 40px -12px rgba(0, 0, 0, 0.65)",
  "border-radius": "12px",
  "font-family": "var(--font-sans)",
};

/**
 * Stellar Wallets Kit (v2) is a static, init-once API. It touches `window`, so
 * it must only be initialized in the browser. `ensureKit()` initializes it on
 * first use and returns the static class for callers.
 */
let initialized = false;

export function ensureKit(): typeof StellarWalletsKit {
  if (typeof window === "undefined") {
    throw new Error("Stellar Wallets Kit is only available in the browser");
  }
  if (!initialized) {
    StellarWalletsKit.init({
      network: config.networkPassphrase as Networks,
      theme: WRITZ_WALLET_THEME,
      modules: [
        new FreighterModule(),
        new xBullModule(),
        new LobstrModule(),
        new AlbedoModule(),
        new RabetModule(),
      ],
    });
    initialized = true;
  }
  return StellarWalletsKit;
}
