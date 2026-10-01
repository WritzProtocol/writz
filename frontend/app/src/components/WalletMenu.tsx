"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { useAnyFlowBusy } from "@/lib/activity";
import { config } from "@/config";
import { GITHUB_ISSUES_URL, GITHUB_SECURITY_URL } from "@/lib/links";

type Chain = "stellar" | "bitcoin";

const CHAIN_NAME: Record<Chain, string> = { stellar: "Stellar", bitcoin: "Bitcoin" };

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

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-ok" : "border border-muted"}`}
    />
  );
}

const ITEM =
  "flex w-full flex-col items-start px-4 py-2.5 text-left transition-colors hover:bg-[#2a251d]";
const SMALL_BUTTON =
  "rounded-full border border-line-2 px-2.5 py-0.5 text-[11px] font-semibold text-body transition-colors hover:border-amber hover:text-head";

/** One header chip for both wallets. Disconnect is an explicit menu action. */
export function WalletMenu() {
  const stellar = useWallet();
  const btc = useBitcoinWallet();
  const flowBusy = useAnyFlowBusy();

  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Chain | null>(null);
  const [copied, setCopied] = useState<Chain | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      setOpen(false);
      setConfirming(null);
    };
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setConfirming(null);
  }

  async function copy(chain: Chain, address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(chain);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard unavailable; the full address is shown and selectable
    }
  }

  function requestDisconnect(chain: Chain) {
    if (flowBusy) {
      setConfirming(chain);
      return;
    }
    disconnect(chain);
  }

  function disconnect(chain: Chain) {
    if (chain === "stellar") stellar.disconnect();
    else btc.disconnect();
    setConfirming(null);
  }

  const anyConnected = !!stellar.address || !!btc.btcAddress;
  const connectedLabel = [stellar.address, btc.btcAddress]
    .filter((a): a is string => !!a)
    .map(truncate)
    .join(" · ");
  const accessibleName = `Wallets: Stellar ${stellar.address ? "connected" : "not connected"}, Bitcoin ${
    btc.btcAddress ? "connected" : "not connected"
  }`;

  function renderConnected(chain: Chain, address: string, role: string, tag?: string) {
    return (
      <div className="flex flex-col gap-1.5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Dot on />
          <span className="text-xs font-semibold text-head">{CHAIN_NAME[chain]} wallet</span>
          {tag ? <span className="text-[10px] text-muted">{tag}</span> : null}
        </div>
        <span className="text-[11px] text-muted">{role}</span>
        <span className="break-all font-mono text-[11px] text-body">{address}</span>
        {confirming === chain ? (
          <div className="mt-1 flex flex-col gap-2 rounded-lg border border-amber/30 bg-amber/5 p-2.5">
            <p className="text-[11px] text-body">
              Disconnect {CHAIN_NAME[chain]} wallet? A transaction is still in progress. It
              will keep going on chain, and you can check it here when you reconnect.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => disconnect(chain)} className={SMALL_BUTTON}>
                Disconnect
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-full bg-amber px-2.5 py-0.5 text-[11px] font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459]"
              >
                Stay connected
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1 flex gap-2">
            <button type="button" onClick={() => copy(chain, address)} className={SMALL_BUTTON}>
              {copied === chain ? "Copied" : "Copy address"}
            </button>
            <button type="button" onClick={() => requestDisconnect(chain)} className={SMALL_BUTTON}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={anyConnected ? accessibleName : undefined}
        className={`inline-flex items-center justify-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
          anyConnected
            ? "border-line-2 bg-surface text-head hover:border-amber"
            : "border-amber/50 bg-amber/10 text-amber hover:border-amber hover:bg-amber/20"
        }`}
      >
        {anyConnected ? (
          <>
            <Dot on={!!btc.btcAddress} />
            <Dot on={!!stellar.address} />
            <span className="font-mono sm:hidden">Wallets</span>
            <span className="hidden font-mono sm:inline">{connectedLabel}</span>
          </>
        ) : (
          <>
            <WalletIcon />
            Connect wallets
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line-2 bg-[#1e1a14] py-1 shadow-xl">
          {stellar.address ? (
            renderConnected(
              "stellar",
              stellar.address,
              "Receives your USDC and signs loan actions.",
              stellar.walletBackend === "privy" ? "Email" : undefined,
            )
          ) : stellar.connecting ? (
            <p className="px-4 py-2.5 text-xs text-amber">Connecting Stellar wallet…</p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  close();
                  stellar.connect();
                }}
                className={ITEM}
              >
                <span className="text-xs font-semibold text-head">Connect Stellar wallet</span>
                <span className="text-[10px] text-muted">Freighter, xBull, Lobstr and others</span>
              </button>
              {config.privyAppId ? (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    stellar.connectWithPrivy();
                  }}
                  className={ITEM}
                >
                  <span className="text-xs font-semibold text-head">Email or social login</span>
                  <span className="text-[10px] text-muted">Creates a Stellar wallet for you</span>
                </button>
              ) : null}
              {stellar.error ? <p className="px-4 pb-2 text-[11px] text-crit">{stellar.error}</p> : null}
            </>
          )}

          <div className="mx-3 my-0.5 border-t border-line-2" />

          {btc.btcAddress ? (
            renderConnected(
              "bitcoin",
              btc.btcAddress,
              "Holds the BTC you lock. Its key builds your lock address.",
            )
          ) : (
            <>
              <button type="button" onClick={btc.connect} disabled={btc.connecting} className={ITEM}>
                <span className="text-xs font-semibold text-head">
                  {btc.connecting ? "Connecting…" : "Connect Xverse"}
                </span>
                <span className="text-[10px] text-muted">Bitcoin {config.bitcoin.network} wallet</span>
              </button>
              {btc.error ? <p className="px-4 pb-2 text-[11px] text-crit">{btc.error}</p> : null}
            </>
          )}

          <div className="mx-3 my-0.5 border-t border-line-2" />

          <div className="flex flex-col gap-1 px-4 py-2.5 text-[11px]">
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted underline-offset-2 hover:text-head hover:underline"
            >
              Report a problem on GitHub
            </a>
            <a
              href={GITHUB_SECURITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted underline-offset-2 hover:text-head hover:underline"
            >
              Report a security issue
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
