"use client";

import { useWallet } from "@/lib/wallet/WalletProvider";

function truncate(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

// Shared box so the button keeps a static width across every state
// (Connect wallet / Connecting… / address) and never shifts the layout.
const BASE =
  "inline-flex min-w-[150px] items-center justify-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors";

export function WalletButton() {
  const { address, connecting, error, connect, disconnect } = useWallet();

  if (address) {
    return (
      <button
        type="button"
        onClick={disconnect}
        title={`${address} — click to disconnect`}
        className={`${BASE} border-line-2 text-head hover:border-amber`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        <span className="font-mono">{truncate(address)}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={connecting}
      title={error ?? undefined}
      className={`${BASE} border-line-2 text-amber hover:border-amber disabled:opacity-50`}
    >
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
