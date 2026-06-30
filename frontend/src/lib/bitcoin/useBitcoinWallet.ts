"use client";

import { useCallback, useState } from "react";
import Wallet, { AddressPurpose } from "sats-connect";

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
      const res = await Wallet.request("getAddresses", {
        purposes: [AddressPurpose.Payment],
        message: "Connect your Bitcoin wallet to Writz Protocol",
      });
      if (res.status === "error") {
        throw new Error(res.error.message ?? "Failed to connect Bitcoin wallet");
      }
      const payment = res.result.addresses.find(
        (a) => a.purpose === AddressPurpose.Payment,
      );
      if (!payment) throw new Error("No payment address returned by wallet");
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
