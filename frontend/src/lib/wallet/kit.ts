import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { config } from "@/config";

/**
 * Writz "Private Vault" theme for the wallet selector modal, so it matches the
 * app instead of the kit's default look. Keys mirror `SwkAppTheme`; values come
 * from the design system (see DESIGN_SYSTEM.md). `font-family` resolves the
 * next/font body variable set on <html>.
 */
const WRITZ_WALLET_THEME = {
  background: "#16130f",
  "background-secondary": "#1e1a14",
  "foreground-strong": "#fbf8f1",
  foreground: "#e8e2d5",
  "foreground-secondary": "#b7af9f",
  primary: "#e3a646",
  "primary-foreground": "#1a1206",
  transparent: "rgba(0, 0, 0, 0)",
  lighter: "#1e1a14",
  light: "#16130f",
  "light-gray": "#877f71",
  gray: "#877f71",
  danger: "#c75b4f",
  border: "#2a251d",
  shadow: "0 16px 40px -12px rgba(0, 0, 0, 0.65)",
  "border-radius": "12px",
  "font-family": "var(--ff-body), ui-sans-serif, system-ui, sans-serif",
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
