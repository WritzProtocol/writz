"use client";

import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";

export function BitcoinWalletButton() {
  const { btcAddress, connecting, error, connect, disconnect } = useBitcoinWallet();

  if (btcAddress) {
    return (
      <button
        type="button"
        onClick={disconnect}
        title={error ?? btcAddress}
        className="flex items-center gap-2 rounded-full border border-line-2 px-3 py-1 text-xs font-semibold text-body transition-colors hover:border-amber"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />
        {btcAddress.slice(0, 8)}…{btcAddress.slice(-6)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={connecting}
      className="flex items-center gap-2 rounded-full border border-line-2 px-3 py-1 text-xs font-semibold text-amber transition-colors hover:border-amber disabled:opacity-60"
    >
      {connecting ? "Connecting…" : "Connect BTC"}
    </button>
  );
}
