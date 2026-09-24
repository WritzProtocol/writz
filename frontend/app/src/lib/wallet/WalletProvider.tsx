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
import { KEY_DERIVATION_MESSAGE, deriveSeed } from "@/lib/position/derive";

/**
 * Signs a transaction XDR with the connected wallet. The return shape is
 * compatible with the generated contract bindings' `signAndSend({ signTransaction })`,
 * so deposit/borrow/repay/supply flows can reuse it directly.
 */
export type SignTransaction = (
  xdr: string,
) => Promise<{ signedTxXdr: string; signerAddress: string }>;

/** Signs an arbitrary message (SEP-53) and returns the base64 signature. */
export type SignMessage = (message: string) => Promise<string>;

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
  /** Connect via Stellar Wallets Kit (Freighter, xBull, Lobstr, Albedo, Rabet). */
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: SignTransaction;
  signMessage: SignMessage;
  /** In-memory master seed (32 bytes) derived from the unlock signature, or null. */
  seed: Uint8Array | null;
  /** True once the user has unlocked (signed the derivation message) this session. */
  unlocked: boolean;
  /** Sign the canonical message → derive + hold the in-memory seed. */
  unlock: () => Promise<void>;
}

// Kept from when a second login backend existed, so kit sessions saved under
// it still restore; any other stored value is a stale session and is cleared.
const SESSION_KEY = "writz.walletBackend";
const SESSION_VALUE = "kit";

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Master seed lives only in memory (never persisted); cleared on disconnect/switch.
  const [seed, setSeed] = useState<Uint8Array | null>(null);

  // ── Session restore on mount ──
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored !== SESSION_VALUE) {
      if (stored !== null) localStorage.removeItem(SESSION_KEY);
      return;
    }
    ensureKit()
      .getAddress()
      .then(({ address: addr }) => {
        if (addr) setAddress(addr);
        else localStorage.removeItem(SESSION_KEY);
      })
      .catch(() => localStorage.removeItem(SESSION_KEY));
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    setSeed(null);
    try {
      const { address: addr } = await ensureKit().authModal();
      setAddress(addr);
      localStorage.setItem(SESSION_KEY, SESSION_VALUE);
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
    setSeed(null);
    setError(null);
    localStorage.removeItem(SESSION_KEY);
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

  const signMessage = useCallback<SignMessage>(async (message) => {
    const kit = ensureKit();
    const { address: addr } = await kit.getAddress();
    const { signedMessage } = await kit.signMessage(message, {
      address: addr,
      networkPassphrase: config.networkPassphrase,
    });
    return signedMessage;
  }, []);

  const unlock = useCallback(async () => {
    const signature = await signMessage(KEY_DERIVATION_MESSAGE);
    setSeed(deriveSeed(signature));
  }, [signMessage]);

  const value = useMemo<WalletState>(
    () => ({
      address,
      connecting,
      error,
      connect,
      disconnect,
      signTransaction,
      signMessage,
      seed,
      unlocked: seed !== null,
      unlock,
    }),
    [
      address,
      connecting,
      error,
      connect,
      disconnect,
      signTransaction,
      signMessage,
      seed,
      unlock,
    ],
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
