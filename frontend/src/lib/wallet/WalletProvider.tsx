"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@privy-io/react-auth";
import type { WalletWithMetadata } from "@privy-io/react-auth";
import { usePrivyBridge } from "@/lib/wallet/privy-bridge";
import { ensureKit } from "@/lib/wallet/kit";
import { config } from "@/config";
import { KEY_DERIVATION_MESSAGE, deriveSeed } from "@/lib/position/derive";
import {
  signMessageWithPrivy,
  signTransactionWithPrivy,
} from "@/lib/wallet/privy-stellar";

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

/** Which auth backend is powering the current session. */
export type WalletBackend = "kit" | "privy";

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
  /** Connect via Stellar Wallets Kit (Freighter, xBull, Lobstr, Albedo, Rabet). */
  connect: () => Promise<void>;
  /**
   * Connect via Privy embedded wallet (email / social login).
   * No-op with an error message when `NEXT_PUBLIC_PRIVY_APP_ID` is not set.
   */
  connectWithPrivy: () => void;
  disconnect: () => void;
  signTransaction: SignTransaction;
  signMessage: SignMessage;
  /** In-memory master seed (32 bytes) derived from the unlock signature, or null. */
  seed: Uint8Array | null;
  /** True once the user has unlocked (signed the derivation message) this session. */
  unlocked: boolean;
  /** Sign the canonical message → derive + hold the in-memory seed. */
  unlock: () => Promise<void>;
  /** Active auth backend, or null when not connected. */
  walletBackend: WalletBackend | null;
}

const BACKEND_KEY = "writz.walletBackend";

function getStellarAddress(user: User | null): string | null {
  if (!user) return null;
  for (const account of user.linkedAccounts) {
    if (account.type === "wallet") {
      const w = account as WalletWithMetadata;
      if (w.chainType === "stellar") return w.address;
    }
  }
  return null;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Privy state comes via bridge context (null when privyAppId is not set).
  const privy = usePrivyBridge();

  // ── Local state ──
  const [backend, setBackend] = useState<WalletBackend | null>(() => {
    if (typeof window === "undefined") return null;
    return (localStorage.getItem(BACKEND_KEY) as WalletBackend | null) ?? null;
  });
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Master seed lives only in memory (never persisted); cleared on disconnect/switch.
  const [seed, setSeed] = useState<Uint8Array | null>(null);

  // Guard against duplicate Stellar wallet creation in the Privy flow.
  const creatingPrivyWallet = useRef(false);

  // ── Kit session restore on mount ──
  useEffect(() => {
    if (backend !== "kit") return;
    ensureKit()
      .getAddress()
      .then(({ address: addr }) => {
        if (addr) {
          setAddress(addr);
        } else {
          setBackend(null);
          localStorage.removeItem(BACKEND_KEY);
        }
      })
      .catch(() => {
        setBackend(null);
        localStorage.removeItem(BACKEND_KEY);
      });
    // Runs once on mount — backend is initialised from localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Privy session sync ──
  // Handles: initial login, page-reload session restore, session expiry.
  // `backend === 'privy'` gates this so the kit path is unaffected.
  useEffect(() => {
    if (!privy || !privy.ready || backend !== "privy") return;

    if (!privy.authenticated) {
      // Session expired or the login modal was dismissed before auth completed.
      // Only clear state when no address was ever set (avoids wiping on SSR
      // where privy.authenticated might briefly lag behind).
      if (!address) {
        setBackend(null);
        localStorage.removeItem(BACKEND_KEY);
      }
      setConnecting(false);
      return;
    }

    const stellarAddress = getStellarAddress(privy.user);

    if (stellarAddress) {
      if (address !== stellarAddress) setAddress(stellarAddress);
      setConnecting(false);
      localStorage.setItem(BACKEND_KEY, "privy");
    } else if (!creatingPrivyWallet.current) {
      // First login — create the user's Stellar embedded wallet.
      creatingPrivyWallet.current = true;
      setConnecting(true);
      privy
        .createWallet({ chainType: "stellar" })
        .then(({ wallet }) => {
          setAddress(wallet.address);
          setConnecting(false);
          creatingPrivyWallet.current = false;
          localStorage.setItem(BACKEND_KEY, "privy");
        })
        .catch((e) => {
          // Wallet might have been created in a race — check once more.
          const existing = getStellarAddress(privy.user);
          if (existing) {
            setAddress(existing);
            setConnecting(false);
          } else {
            setError(
              e instanceof Error
                ? e.message
                : "Failed to create Stellar wallet",
            );
            setBackend(null);
            setConnecting(false);
            localStorage.removeItem(BACKEND_KEY);
          }
          creatingPrivyWallet.current = false;
        });
    }
  }, [privy?.ready, privy?.authenticated, privy?.user, backend, address]);

  // ── Kit connect ──
  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    setSeed(null);
    setBackend("kit");
    try {
      const { address: addr } = await ensureKit().authModal();
      setAddress(addr);
      localStorage.setItem(BACKEND_KEY, "kit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
      setBackend(null);
    } finally {
      setConnecting(false);
    }
  }, []);

  // ── Privy connect ──
  const connectWithPrivy = useCallback(() => {
    if (!privy) {
      setError(
        "Privy is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID in your environment.",
      );
      return;
    }
    setError(null);
    setSeed(null);
    setBackend("privy");
    privy.login();
    // Auth state changes are handled reactively by the Privy effect above.
  }, [privy]);

  // ── Disconnect ──
  const disconnect = useCallback(() => {
    if (backend === "kit") {
      ensureKit()
        .disconnect()
        .catch(() => {});
    } else if (backend === "privy" && privy) {
      privy.logout().catch(() => {});
      creatingPrivyWallet.current = false;
    }
    setAddress(null);
    setSeed(null);
    setBackend(null);
    setError(null);
    localStorage.removeItem(BACKEND_KEY);
  }, [backend, privy]);

  // ── Signing — dispatches to the active backend ──
  const signTransaction = useCallback<SignTransaction>(
    async (xdr) => {
      if (backend === "privy") {
        if (!address || !privy)
          throw new Error("No Privy wallet connected");
        return signTransactionWithPrivy(xdr, address, privy.signRawHash);
      }
      const kit = ensureKit();
      const { address: signerAddress } = await kit.getAddress();
      const { signedTxXdr, signerAddress: signer } = await kit.signTransaction(
        xdr,
        { address: signerAddress, networkPassphrase: config.networkPassphrase },
      );
      return { signedTxXdr, signerAddress: signer ?? signerAddress };
    },
    [backend, address, privy],
  );

  const signMessage = useCallback<SignMessage>(
    async (message) => {
      if (backend === "privy") {
        if (!address || !privy)
          throw new Error("No Privy wallet connected");
        return signMessageWithPrivy(message, address, privy.signRawHash);
      }
      const kit = ensureKit();
      const { address: addr } = await kit.getAddress();
      const { signedMessage } = await kit.signMessage(message, {
        address: addr,
        networkPassphrase: config.networkPassphrase,
      });
      return signedMessage;
    },
    [backend, address, privy],
  );

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
      connectWithPrivy,
      disconnect,
      signTransaction,
      signMessage,
      seed,
      unlocked: seed !== null,
      unlock,
      walletBackend: backend,
    }),
    [
      address,
      connecting,
      error,
      connect,
      connectWithPrivy,
      disconnect,
      signTransaction,
      signMessage,
      seed,
      unlock,
      backend,
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
