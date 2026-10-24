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
import { Horizon, NotFoundError } from "@stellar/stellar-sdk";
import { ensureKit } from "@/lib/wallet/kit";
import { config } from "@/config";
import { pollarClient, signMessageWithPollar, signTransactionWithPollar } from "@/lib/wallet/pollar";
import { usePollarSession, type PollarSession } from "@/lib/wallet/pollarSession";
import { withRejection } from "@/lib/wallet/rejection";
import { preflightSign, type AccountSnapshot } from "@/lib/wallet/precheck";

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
export type WalletBackend = "kit" | "pollar";

/** Email, Google or GitHub sign-in through Pollar, which gives the user a custodial testnet wallet. */
export interface PollarLogin {
  session: PollarSession;
  login: (provider: "google" | "github") => void;
  loginWithEmail: (email: string) => void;
  verifyCode: (code: string) => void;
  cancel: () => void;
}

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
  /** Connect via Stellar Wallets Kit (Freighter, xBull, Lobstr, Albedo, Rabet). */
  connect: () => Promise<void>;
  /** Null when `NEXT_PUBLIC_POLLAR_API_KEY` is not set. */
  pollar: PollarLogin | null;
  disconnect: () => void;
  signTransaction: SignTransaction;
  signMessage: SignMessage;
  /** Active auth backend, or null when not connected. */
  walletBackend: WalletBackend | null;
  /** A remembered session is still being restored, so whether a wallet is connected isn't known yet. */
  restoring: boolean;
}

const BACKEND_KEY = "writz.walletBackend";
const POLLAR_SETTLED = new Set<string>(["idle", "authenticated", "error"]);

function kitWalletName(): string | undefined {
  try {
    return ensureKit().selectedModule.productName;
  } catch {
    return undefined;
  }
}

async function loadAccountSnapshot(address: string): Promise<AccountSnapshot | null> {
  try {
    return await new Horizon.Server(config.horizonUrl).loadAccount(address);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

function assertPollarWalletReady(session: PollarSession): string {
  if (!session.address) throw new Error("No Pollar wallet connected");
  if (session.provisioning === "CREATING") {
    throw new Error("Your account is still being created on Stellar. Try again in a few seconds.");
  }
  if (session.provisioning === "FAILED") {
    throw new Error("Your account could not be created on Stellar. Sign out and sign in again.");
  }
  return session.address;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const pollarSession = usePollarSession();
  const pollarEnabled = Boolean(config.pollarApiKey);

  // ── Local state ──
  const [backend, setBackend] = useState<WalletBackend | null>(() => {
    if (typeof window === "undefined") return null;
    return (localStorage.getItem(BACKEND_KEY) as WalletBackend | null) ?? null;
  });
  const [kitAddress, setKitAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A login started here; until it settles, an idle Pollar state is not a signed-out one.
  const pollarLoggingIn = useRef(false);
  const creatingPollarWallet = useRef(false);

  const address = backend === "pollar" ? pollarSession.address : kitAddress;

  // ── Kit session restore on mount ──
  useEffect(() => {
    if (backend !== "kit") return;
    ensureKit()
      .getAddress()
      .then(({ address: addr }) => {
        if (addr) {
          setKitAddress(addr);
        } else {
          setBackend(null);
          localStorage.removeItem(BACKEND_KEY);
        }
      })
      .catch(() => {
        setBackend(null);
        localStorage.removeItem(BACKEND_KEY);
      });
    // Runs once on mount - backend is initialised from localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pollar session sync: login, reload restore, expiry, first wallet ──
  useEffect(() => {
    if (backend !== "pollar" || !pollarSession.ready) return;
    const { auth } = pollarSession;
    const client = pollarClient();

    if (auth.step === "authenticated") {
      pollarLoggingIn.current = false;
      localStorage.setItem(BACKEND_KEY, "pollar");
      if (!pollarSession.address && client && !client.hasWallet() && !creatingPollarWallet.current) {
        creatingPollarWallet.current = true;
        client
          .createWallet()
          .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to create Stellar wallet"))
          .finally(() => {
            creatingPollarWallet.current = false;
          });
      }
      return;
    }
    if (auth.step === "error") {
      pollarLoggingIn.current = false;
      void Promise.resolve().then(() => {
        setError(auth.message);
        setBackend(null);
      });
      localStorage.removeItem(BACKEND_KEY);
      return;
    }
    if (auth.step === "idle" && !pollarLoggingIn.current) {
      void Promise.resolve().then(() => setBackend(null));
      localStorage.removeItem(BACKEND_KEY);
    }
  }, [backend, pollarSession]);

  // ── Kit connect ──
  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    setBackend("kit");
    try {
      const { address: addr } = await ensureKit().authModal();
      setKitAddress(addr);
      localStorage.setItem(BACKEND_KEY, "kit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
      setBackend(null);
    } finally {
      setConnecting(false);
    }
  }, []);

  // ── Pollar connect ──
  const startPollar = useCallback((start: (client: NonNullable<ReturnType<typeof pollarClient>>) => void) => {
    const client = pollarClient();
    if (!client) {
      setError("Email and social login are not configured. Set NEXT_PUBLIC_POLLAR_API_KEY in your environment.");
      return;
    }
    setError(null);
    pollarLoggingIn.current = true;
    setBackend("pollar");
    start(client);
  }, []);

  const pollar = useMemo<PollarLogin | null>(() => {
    if (!pollarEnabled) return null;
    return {
      session: pollarSession,
      login: (provider) => startPollar((c) => c.login({ provider })),
      loginWithEmail: (email) => startPollar((c) => c.login({ provider: "email", email })),
      verifyCode: (code) => pollarClient()?.verifyEmailCode(code),
      cancel: () => {
        pollarLoggingIn.current = false;
        pollarClient()?.cancelLogin();
      },
    };
  }, [pollarEnabled, pollarSession, startPollar]);

  // ── Disconnect ──
  const disconnect = useCallback(() => {
    if (backend === "kit") {
      ensureKit()
        .disconnect()
        .catch(() => {});
    } else if (backend === "pollar") {
      pollarLoggingIn.current = false;
      pollarClient()?.logout().catch(() => {});
    }
    setKitAddress(null);
    setBackend(null);
    setError(null);
    localStorage.removeItem(BACKEND_KEY);
  }, [backend]);

  // ── Signing - dispatches to the active backend ──
  const signTransaction = useCallback<SignTransaction>(
    async (xdr) => {
      if (backend === "pollar") {
        const client = pollarClient();
        if (!client) throw new Error("No Pollar wallet connected");
        const signer = assertPollarWalletReady(pollarSession);
        const result = await withRejection("stellar", "Pollar", () => signTransactionWithPollar(client, xdr, signer));
        // A sponsored envelope needs no XLM; one Pollar would not sponsor is paid by the user.
        if (!result.sponsored) {
          await preflightSign({
            xdr,
            expectedPassphrase: config.networkPassphrase,
            getWalletPassphrase: async () => null,
            loadAccount: () => loadAccountSnapshot(signer),
          });
        }
        return { signedTxXdr: result.signedTxXdr, signerAddress: result.signerAddress };
      }
      const kit = ensureKit();
      const walletName = kitWalletName();
      const { address: signerAddress } = await kit.getAddress();
      await preflightSign({
        xdr,
        expectedPassphrase: config.networkPassphrase,
        walletName,
        getWalletPassphrase: async () => (await kit.getNetwork()).networkPassphrase,
        loadAccount: () => loadAccountSnapshot(signerAddress),
      });
      const { signedTxXdr, signerAddress: signer } = await withRejection("stellar", walletName, () =>
        kit.signTransaction(xdr, {
          address: signerAddress,
          networkPassphrase: config.networkPassphrase,
        }),
      );
      return { signedTxXdr, signerAddress: signer ?? signerAddress };
    },
    [backend, pollarSession],
  );

  const signMessage = useCallback<SignMessage>(
    async (message) => {
      if (backend === "pollar") {
        const client = pollarClient();
        if (!client) throw new Error("No Pollar wallet connected");
        assertPollarWalletReady(pollarSession);
        return withRejection("stellar", "Pollar", () => signMessageWithPollar(client, message));
      }
      const kit = ensureKit();
      const walletName = kitWalletName();
      const { address: addr } = await kit.getAddress();
      const { signedMessage } = await withRejection("stellar", walletName, () =>
        kit.signMessage(message, {
          address: addr,
          networkPassphrase: config.networkPassphrase,
        }),
      );
      return signedMessage;
    },
    [backend, pollarSession],
  );

  const pollarConnecting = backend === "pollar" && !POLLAR_SETTLED.has(pollarSession.auth.step);

  const value = useMemo<WalletState>(
    () => ({
      address,
      connecting: connecting || pollarConnecting,
      error,
      connect,
      pollar,
      disconnect,
      signTransaction,
      signMessage,
      walletBackend: backend,
      restoring:
        address === null &&
        (backend === "kit" || (backend === "pollar" && pollarEnabled && !pollarSession.ready)),
    }),
    [
      address,
      connecting,
      pollarConnecting,
      error,
      connect,
      pollar,
      disconnect,
      signTransaction,
      signMessage,
      backend,
      pollarEnabled,
      pollarSession.ready,
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
