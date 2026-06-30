"use client";

import { useCallback, useState } from "react";
import Wallet, { AddressPurpose, BitcoinNetworkType, RpcErrorCode } from "sats-connect";
import { config } from "@/config";

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

export interface BitcoinWalletState {
  btcAddress: string | null;
  btcPubkey: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendBtc: (toAddress: string, amountSats: number) => Promise<string>;
  signPsbt: (psbtBase64: string) => Promise<string>;
}

export function useBitcoinWallet(): BitcoinWalletState {
  const [btcAddress, setBtcAddress] = useState<string | null>(null);
  const [btcPubkey, setBtcPubkey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          `Switch your Bitcoin wallet to ${config.bitcoin.network} (currently ${active}).`,
        );
      }
      setBtcAddress(payment.address);
      setBtcPubkey(payment.publicKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Bitcoin wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setBtcAddress(null);
    setBtcPubkey(null);
    setError(null);
  }, []);

  const sendBtc = useCallback(
    async (toAddress: string, amountSats: number): Promise<string> => {
      const res = await Wallet.request("sendTransfer", {
        recipients: [{ address: toAddress, amount: amountSats }],
      });
      if (res.status === "error") {
        throw new Error(res.error.message ?? "Bitcoin transfer failed");
      }
      return res.result.txid;
    },
    [],
  );

  const signPsbt = useCallback(async (psbtBase64: string): Promise<string> => {
    const res = await Wallet.request("signPsbt", {
      psbt: psbtBase64,
      signInputs: { "0": [0] },
      broadcast: false,
    });
    if (res.status === "error") {
      throw new Error(res.error.message ?? "PSBT signing failed");
    }
    return res.result.psbt;
  }, []);

  return { btcAddress, btcPubkey, connecting, error, connect, disconnect, sendBtc, signPsbt };
}
