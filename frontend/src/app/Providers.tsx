"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { config } from "@/config";
import {
  PrivyBridgeActive,
  PrivyBridgeDisabled,
} from "@/lib/wallet/privy-bridge";

/**
 * Client-side provider tree. Conditionally wraps the app with PrivyProvider
 * so that:
 *  - When `NEXT_PUBLIC_PRIVY_APP_ID` is set: Privy is fully initialized and the
 *    embedded wallet / social-login path in WalletProvider is available.
 *  - When it is absent: no Privy network calls are made; PrivyBridgeDisabled
 *    provides a null context and WalletProvider falls back to Stellar Wallets Kit
 *    only (the existing behavior before this integration).
 *
 * WalletProvider must be nested inside this component because it reads the
 * PrivyBridgeContext injected here.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  if (!config.privyAppId) {
    return <PrivyBridgeDisabled>{children}</PrivyBridgeDisabled>;
  }

  return (
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
        appearance: {
          theme: "dark",
          accentColor: "#e3a646",
        },
      }}
    >
      <PrivyBridgeActive>{children}</PrivyBridgeActive>
    </PrivyProvider>
  );
}
