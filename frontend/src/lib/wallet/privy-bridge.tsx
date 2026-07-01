"use client";

import { createContext, useContext, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignRawHash,
} from "@privy-io/react-auth/extended-chains";
import type { User } from "@privy-io/react-auth";

export interface PrivyBridge {
  login: () => void;
  logout: () => Promise<void>;
  ready: boolean;
  authenticated: boolean;
  user: User | null;
  createWallet: (opts: { chainType: "stellar" }) => Promise<{
    wallet: { address: string };
  }>;
  signRawHash: (opts: {
    address: string;
    chainType: "stellar";
    hash: `0x${string}`;
  }) => Promise<{ signature: `0x${string}` }>;
}

/**
 * Null context value = Privy is not configured. WalletProvider reads this to
 * decide whether the Privy connect path is available.
 */
const PrivyBridgeContext = createContext<PrivyBridge | null>(null);

/**
 * Inner component that calls Privy hooks. Must be rendered inside
 * `<PrivyProvider>` — never instantiated when privyAppId is absent.
 */
function PrivyBridgeActive({ children }: { children: React.ReactNode }) {
  const {
    login,
    logout,
    ready,
    authenticated,
    user,
  } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();

  const value = useMemo<PrivyBridge>(
    () => ({
      login: () => login(),
      logout,
      ready,
      authenticated,
      user,
      createWallet: (opts) =>
        createWallet(opts) as Promise<{ wallet: { address: string } }>,
      signRawHash,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, authenticated, user],
  );

  return (
    <PrivyBridgeContext.Provider value={value}>
      {children}
    </PrivyBridgeContext.Provider>
  );
}

/**
 * Renders the null context — no Privy available (appId not configured).
 */
export function PrivyBridgeDisabled({ children }: { children: React.ReactNode }) {
  return (
    <PrivyBridgeContext.Provider value={null}>
      {children}
    </PrivyBridgeContext.Provider>
  );
}

export { PrivyBridgeActive };

export function usePrivyBridge(): PrivyBridge | null {
  return useContext(PrivyBridgeContext);
}
