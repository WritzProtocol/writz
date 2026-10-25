"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Wallet, { AddressPurpose, BitcoinNetworkType, MessageSigningProtocols, RpcErrorCode } from "sats-connect";
import { config, BTC_NETWORK_LABEL } from "@/config";
import { usePollarSession } from "@/lib/wallet/pollarSession";
import { reportStep } from "@/lib/onboarding/funnel";
import { browserStorage } from "@/lib/onboarding/storage";
import { xverseRequest } from "./xverse";
import {
  assertEmbeddedAllowed,
  embeddedSignetAllowed,
  exportKeyFile,
  importKey,
  loadOrCreateKey,
  signBitcoinMessage,
  signReleasePsbt,
  type SignetKey,
} from "./embedded/key";
import { sendFromKey } from "./embedded/send";

/** The Signet test key is offered with social sign-in, on testnet with Bitcoin signet only. */
export const EMBEDDED_SIGNET = embeddedSignetAllowed(config.target, config.bitcoin.network) && Boolean(config.pollarApiKey);

/** How the UI names the test key wherever it appears. */
export const TEST_KEY_NAME = "Signet test key";

/** Map the configured BTC network string to the sats-connect network type. */
function walletNetwork(): BitcoinNetworkType {
  switch (config.bitcoin.network) {
    case "mainnet":
      return BitcoinNetworkType.Mainnet;
    case "signet":
      return BitcoinNetworkType.Signet;
    case "testnet4":
      return BitcoinNetworkType.Testnet4;
    default:
      return BitcoinNetworkType.Testnet;
  }
}

/** The browser-held Signet test key of a social-login account (testnet only). */
export interface EmbeddedSignet {
  address: string;
  pubkey: string;
  /** True while it is the wallet the app signs with (not Xverse). */
  active: boolean;
  /** The backup file's text (see `exportKeyFile`). */
  exportFile(): string;
  /** Replaces this account's key with the one in a backup file or a Signet WIF. Throws a readable error. */
  importFile(text: string): void;
  /** Switches back to the test key after using Xverse. */
  use(): void;
}

export interface BitcoinWalletState {
  /** Which wallet signs: the Xverse extension or the embedded Signet test key. */
  kind: "xverse" | "embedded" | null;
  /** "Xverse" or "Signet test key", for prompts. */
  walletName: string;
  /** Null when there is no test key for this session. */
  embedded: EmbeddedSignet | null;
  btcAddress: string | null;
  btcPubkey: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendBtc: (toAddress: string, amountSats: number) => Promise<string>;
  signPsbt: (psbtBase64: string) => Promise<string>;
  /** Signs `message` with the connected payment key (ECDSA, BIP-137); returns base64. */
  signMessage: (message: string) => Promise<string>;
}

const BitcoinWalletContext = createContext<BitcoinWalletState | null>(null);

/**
 * Shares one Bitcoin-wallet connection across the whole app. Without this, each
 * `useBitcoinWallet()` caller (header button, deposit form, position card) would
 * hold its own state, so connecting in one place wouldn't be visible in another
 * (e.g. the release flow would think the wallet is disconnected).
 */
export function BitcoinWalletProvider({ children }: { children: React.ReactNode }) {
  const [xverseAddress, setBtcAddress] = useState<string | null>(null);
  const [xversePubkey, setBtcPubkey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** "xverse" once the user connects Xverse; the test key is the default when one exists. */
  const [preferXverse, setPreferXverse] = useState(false);

  // ── Embedded Signet test key, one per Pollar account ──
  const pollar = usePollarSession();
  const stellarAddress = pollar.address;
  const accountId =
    pollar.auth.step === "authenticated" && stellarAddress ? (pollar.auth.session.userId ?? `wallet:${stellarAddress}`) : null;
  const [embeddedState, setEmbeddedState] = useState<{ accountId: string; key: SignetKey } | null>(null);
  const [embeddedError, setEmbeddedError] = useState<string | null>(null);
  useEffect(() => {
    if (!EMBEDDED_SIGNET || !accountId || !stellarAddress) return;
    const storage = browserStorage();
    if (!storage) return;
    try {
      const { key, created } = loadOrCreateKey(storage, accountId);
      void Promise.resolve().then(() => setEmbeddedState({ accountId, key }));
      if (created) {
        void reportStep("key_created", { stellarAddress, channel: "social" }, { relayerUrl: config.services.relayerUrl, storage });
      }
    } catch (e) {
      void Promise.resolve().then(() => setEmbeddedError(e instanceof Error ? e.message : "Could not create the test key."));
    }
  }, [accountId, stellarAddress]);
  const key = embeddedState && embeddedState.accountId === accountId ? embeddedState.key : null;

  const embeddedActive = Boolean(key) && !(preferXverse && xverseAddress);
  const btcAddress = embeddedActive ? key!.address : xverseAddress;
  const btcPubkey = embeddedActive ? key!.pubkey.toString("hex") : xversePubkey;
  const kind: BitcoinWalletState["kind"] = embeddedActive ? "embedded" : xverseAddress ? "xverse" : null;

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      // `wallet_connect` establishes the connection + read permissions in one
      // step and returns the addresses. Calling `getAddresses` directly (before
      // connecting) makes Xverse reject with ACCESS_DENIED. We also request the
      // configured network (Signet) so the returned addresses match the protocol.
      const res = await Wallet.request("wallet_connect", {
        addresses: [AddressPurpose.Payment],
        message: "Connect your Bitcoin wallet to Writz Protocol",
        network: walletNetwork(),
      });
      if (res.status === "error") {
        if (res.error.code === RpcErrorCode.USER_REJECTION) {
          throw new Error("Connection rejected in your Bitcoin wallet.");
        }
        throw new Error(res.error.message ?? "Failed to connect Bitcoin wallet");
      }
      const payment = res.result.addresses.find(
        (a) => a.purpose === AddressPurpose.Payment,
      );
      if (!payment) throw new Error("No payment address returned by wallet");

      const active = res.result.network.bitcoin.name;
      if (active !== walletNetwork()) {
        throw new Error(
          `Switch your Bitcoin wallet to ${BTC_NETWORK_LABEL} (currently ${active}).`,
        );
      }
      setBtcAddress(payment.address);
      setBtcPubkey(payment.publicKey);
      setPreferXverse(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Bitcoin wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    // The test key cannot be disconnected; disconnecting Xverse falls back to it.
    setBtcAddress(null);
    setBtcPubkey(null);
    setPreferXverse(false);
    setError(null);
  }, []);

  const sendBtc = useCallback(
    async (toAddress: string, amountSats: number): Promise<string> => {
      if (embeddedActive && key) {
        assertEmbeddedAllowed(config.target, config.bitcoin.network);
        return sendFromKey(key, toAddress, amountSats, { apiUrl: config.bitcoin.apiUrl });
      }
      const res = await xverseRequest(() =>
        Wallet.request("sendTransfer", {
          recipients: [{ address: toAddress, amount: amountSats }],
        }),
      );
      return res.txid;
    },
    [embeddedActive, key],
  );

  const signPsbt = useCallback(
    async (psbtBase64: string): Promise<string> => {
      if (!btcAddress) throw new Error("Connect your Bitcoin wallet first");
      if (embeddedActive && key) {
        assertEmbeddedAllowed(config.target, config.bitcoin.network);
        return signReleasePsbt(psbtBase64, key);
      }
      const res = await xverseRequest(() =>
        Wallet.request("signPsbt", {
          psbt: psbtBase64,
          // signInputs is keyed by address → input indices it should sign. The
          // release PSBT has a single P2WSH input (index 0) the user must sign.
          signInputs: { [btcAddress]: [0] },
          broadcast: false,
        }),
      );
      return res.psbt;
    },
    [btcAddress, embeddedActive, key],
  );

  const signMessage = useCallback(
    async (message: string): Promise<string> => {
      if (!btcAddress) throw new Error("Connect your Bitcoin wallet first");
      if (embeddedActive && key) {
        assertEmbeddedAllowed(config.target, config.bitcoin.network);
        return signBitcoinMessage(message, key);
      }
      const res = await xverseRequest(() =>
        Wallet.request("signMessage", {
          address: btcAddress,
          message,
          // ECDSA (BIP-137) is what the lending contracts verify on-chain;
          // BIP-322 signatures have a different shape.
          protocol: MessageSigningProtocols.ECDSA,
        }),
      );
      return res.signature;
    },
    [btcAddress, embeddedActive, key],
  );

  const embedded = useMemo<EmbeddedSignet | null>(() => {
    if (!key || !accountId) return null;
    return {
      address: key.address,
      pubkey: key.pubkey.toString("hex"),
      active: embeddedActive,
      exportFile: () => exportKeyFile(key),
      importFile: (text: string) => {
        const storage = browserStorage();
        if (!storage) throw new Error("This browser blocks storage, so it cannot keep a test key.");
        const imported = importKey(storage, accountId, text);
        setEmbeddedState({ accountId, key: imported });
        setPreferXverse(false);
      },
      use: () => setPreferXverse(false),
    };
  }, [key, accountId, embeddedActive]);

  const walletName = kind === "embedded" ? TEST_KEY_NAME : "Xverse";
  const shownError = error ?? (EMBEDDED_SIGNET && accountId ? embeddedError : null);
  const value = useMemo<BitcoinWalletState>(
    () => ({
      kind,
      walletName,
      embedded,
      btcAddress,
      btcPubkey,
      connecting,
      error: shownError,
      connect,
      disconnect,
      sendBtc,
      signPsbt,
      signMessage,
    }),
    [kind, walletName, embedded, btcAddress, btcPubkey, connecting, shownError, connect, disconnect, sendBtc, signPsbt, signMessage],
  );

  return <BitcoinWalletContext.Provider value={value}>{children}</BitcoinWalletContext.Provider>;
}

export function useBitcoinWallet(): BitcoinWalletState {
  const ctx = useContext(BitcoinWalletContext);
  if (!ctx) throw new Error("useBitcoinWallet must be used within a BitcoinWalletProvider");
  return ctx;
}
