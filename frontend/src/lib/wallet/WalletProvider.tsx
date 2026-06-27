"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ensureKit } from "@/lib/wallet/kit";
import { config } from "@/config";

/**
 * Signs a transaction XDR with the connected wallet. The return shape is
 * compatible with the generated contract bindings' `signAndSend({ signTransaction })`,
 * so deposit/borrow/repay/supply flows can reuse it directly.
 */
export type SignTransaction = (
  xdr: string,
) => Promise<{ signedTxXdr: string; signerAddress: string }>;

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: SignTransaction;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore a previously connected wallet from the kit's own persistence.
  useEffect(() => {
    (async () => {
      try {
        const { address } = await ensureKit().getAddress();
        if (address) setAddress(address);
      } catch {
        // not connected yet — leave disconnected
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const { address } = await ensureKit().authModal();
      setAddress(address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    ensureKit()
      .disconnect()
      .catch(() => {});
    setAddress(null);
    setError(null);
  }, []);

  const signTransaction = useCallback<SignTransaction>(async (xdr) => {
    const kit = ensureKit();
    const { address: signerAddress } = await kit.getAddress();
    const { signedTxXdr, signerAddress: signer } = await kit.signTransaction(
      xdr,
      { address: signerAddress, networkPassphrase: config.networkPassphrase },
    );
    return { signedTxXdr, signerAddress: signer ?? signerAddress };
  }, []);

  const value = useMemo<WalletState>(
    () => ({ address, connecting, error, connect, disconnect, signTransaction }),
    [address, connecting, error, connect, disconnect, signTransaction],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return ctx;
}
