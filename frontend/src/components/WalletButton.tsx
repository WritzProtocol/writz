"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";

function truncate(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
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

export function WalletButton() {
  const {
    address,
    connecting,
    error,
    connect,
    connectWithPrivy,
    disconnect,
    walletBackend,
  } = useWallet();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  if (address) {
    return (
      <button
        type="button"
        onClick={disconnect}
        title={`${address} — click to disconnect`}
        className={`${BASE} border border-line-2 bg-surface text-head hover:border-amber`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        {walletBackend === "privy" && (
          <span className="text-[9px] text-muted">✦</span>
        )}
        <span className="font-mono">{truncate(address)}</span>
      </button>
    );
  }

  if (connecting) {
    return (
      <button
        type="button"
        disabled
        className={`${BASE} border-line-2 text-amber opacity-50`}
      >
        Connecting…
      </button>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title={error ?? undefined}
        className={`${BASE} border border-amber/50 bg-amber/10 text-amber hover:border-amber hover:bg-amber/20`}
      >
        <WalletIcon />
        Connect wallet
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded-xl border border-line-2 bg-[#1e1a14] py-1 shadow-xl">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              connect();
            }}
            className="flex w-full flex-col items-start px-4 py-2.5 text-left transition-colors hover:bg-[#2a251d]"
          >
            <span className="text-xs font-semibold text-head">
              Stellar wallet
            </span>
            <span className="text-[10px] text-muted">
              Freighter, xBull, Lobstr…
            </span>
          </button>

          <div className="mx-3 my-0.5 border-t border-line-2" />

          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              connectWithPrivy();
            }}
            className="flex w-full flex-col items-start px-4 py-2.5 text-left transition-colors hover:bg-[#2a251d]"
          >
            <span className="text-xs font-semibold text-head">
              Email / Social
            </span>
            <span className="text-[10px] text-muted">
              Embedded wallet via Privy
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
