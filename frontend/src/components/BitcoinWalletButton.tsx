"use client";

import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function WalletIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}

const BASE =
  "inline-flex min-w-[150px] items-center justify-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors";

export function BitcoinWalletButton() {
  const { btcAddress, connecting, error, connect, disconnect } = useBitcoinWallet();

  if (btcAddress) {
    return (
      <button
        type="button"
        onClick={disconnect}
        title={`${btcAddress} — click to disconnect`}
        className={`${BASE} border border-line-2 bg-surface text-head hover:border-amber`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        <span className="font-mono">{truncate(btcAddress)}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={connecting}
      title={error ?? "Connect your Bitcoin wallet (Xverse)"}
      className={`${BASE} border border-amber/50 bg-amber/10 text-amber hover:border-amber hover:bg-amber/20 disabled:opacity-50`}
    >
      <WalletIcon />
      {connecting ? "Connecting…" : "Connect Bitcoin"}
    </button>
  );
}
