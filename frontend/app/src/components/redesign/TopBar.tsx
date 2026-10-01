"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { useAnyFlowBusy } from "@/lib/activity";
import { config, BTC_NETWORK_LABEL } from "@/config";
import { networkName } from "@/lib/wallet/precheck";
import { GITHUB_ISSUES_URL, GITHUB_SECURITY_URL } from "@/lib/links";
import { shortAddress } from "@/lib/borrow/journey";
import { useMockWorld } from "./hooks";
import { ExternalLink } from "./ui";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Borrow", href: "/borrow/new" },
  { label: "Protocol", href: "/metrics" },
];

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="wz-top">
      <div className="wz-top-inner">
        <Link href="/" className="wz-lockup" aria-label="Writz home" />
        <nav className="wz-nav" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={
                pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)) ? "page" : undefined
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="wz-top-end">
          <span className="wz-pill">{networkName(config.networkPassphrase)}</span>
          <WalletsChip />
        </div>
      </div>
    </header>
  );
}

type Chain = "stellar" | "bitcoin";
const CHAIN_NAME: Record<Chain, string> = { stellar: "Stellar", bitcoin: "Bitcoin" };

/** Both wallets in one chip. Disconnect is an explicit action and asks first while a transaction is running. */
function WalletsChip() {
  const stellar = useWallet();
  const btc = useBitcoinWallet();
  const mock = useMockWorld();
  const flowBusy = useAnyFlowBusy();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Chain | null>(null);
  const [copied, setCopied] = useState<Chain | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);

  const stellarAddress = mock ? (mock.wallets.stellar?.address ?? null) : stellar.address;
  const btcAddress = mock ? (mock.wallets.bitcoin?.address ?? null) : btc.btcAddress;

  useEffect(() => {
    if (!open) return;
    const close = (refocus: boolean) => {
      setOpen(false);
      setConfirming(null);
      if (refocus) chip.current?.focus();
    };
    const onPointer = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function copy(chain: Chain, address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(chain);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard unavailable: the full address is shown and selectable.
    }
  }

  function disconnect(chain: Chain) {
    if (mock) return;
    if (chain === "stellar") stellar.disconnect();
    else btc.disconnect();
    setConfirming(null);
  }

  const any = Boolean(stellarAddress || btcAddress);
  const name = `Wallets: Stellar ${stellarAddress ? "connected" : "not connected"}, Bitcoin ${btcAddress ? "connected" : "not connected"}`;

  function connected(chain: Chain, address: string, role: string) {
    return (
      <div className="wz-menu-section">
        <span className="wz-menu-title">
          <i className="wz-dot" data-on="true" aria-hidden="true" />
          {CHAIN_NAME[chain]} wallet
        </span>
        <span className="wz-menu-role">{role}</span>
        <span className="wz-menu-addr mono">{address}</span>
        {confirming === chain ? (
          <div className="wz-note" data-tone="warning" role="status">
            <p>
              Disconnect {CHAIN_NAME[chain]} wallet? A transaction is still in progress. It will keep going on chain,
              and you can check it here when you reconnect.
            </p>
            <div className="wz-actions">
              <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={() => disconnect(chain)}>
                Disconnect
              </button>
              <button type="button" className="wz-btn wz-btn-gold wz-btn-sm" onClick={() => setConfirming(null)}>
                Stay connected
              </button>
            </div>
          </div>
        ) : (
          <div className="wz-menu-actions">
            <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={() => copy(chain, address)}>
              {copied === chain ? "Copied" : "Copy address"}
            </button>
            <button
              type="button"
              className="wz-btn wz-btn-line wz-btn-sm"
              onClick={() => (flowBusy ? setConfirming(chain) : disconnect(chain))}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wz-wallets" ref={root}>
      <button
        ref={chip}
        type="button"
        className="wz-chip"
        data-empty={!any}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={any ? name : undefined}
        onClick={() => {
          setOpen((o) => !o);
          setConfirming(null);
        }}
      >
        {any ? (
          <>
            <i className="wz-dot" data-on={Boolean(btcAddress)} aria-hidden="true" />
            <i className="wz-dot" data-on={Boolean(stellarAddress)} aria-hidden="true" />
            <span className="mono">{stellarAddress ? shortAddress(stellarAddress) : "Wallets"}</span>
          </>
        ) : (
          "Connect wallets"
        )}
      </button>
      {open && (
        <div className="wz-menu">
          {stellarAddress ? (
            connected("stellar", stellarAddress, "Receives your USDC and signs loan actions.")
          ) : (
            <div className="wz-menu-section">
              <span className="wz-menu-title">Stellar wallet</span>
              <span className="wz-menu-role">Freighter, xBull, Lobstr and others</span>
              <div className="wz-menu-actions">
                <button
                  type="button"
                  className="wz-btn wz-btn-gold wz-btn-sm"
                  disabled={stellar.connecting}
                  onClick={() => {
                    setOpen(false);
                    void stellar.connect();
                  }}
                >
                  {stellar.connecting ? "Confirm in your wallet" : "Connect Stellar wallet"}
                </button>
                {config.privyAppId ? (
                  <button
                    type="button"
                    className="wz-btn wz-btn-line wz-btn-sm"
                    onClick={() => {
                      setOpen(false);
                      stellar.connectWithPrivy();
                    }}
                  >
                    Email or social login
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {btcAddress ? (
            connected("bitcoin", btcAddress, "Holds the BTC you lock. Its key builds your lock address.")
          ) : (
            <div className="wz-menu-section">
              <span className="wz-menu-title">Bitcoin wallet</span>
              <span className="wz-menu-role">Xverse on {BTC_NETWORK_LABEL}</span>
              <div className="wz-menu-actions">
                <button
                  type="button"
                  className="wz-btn wz-btn-line wz-btn-sm"
                  disabled={btc.connecting}
                  onClick={() => void btc.connect()}
                >
                  {btc.connecting ? "Confirm in Xverse" : "Connect Xverse"}
                </button>
              </div>
            </div>
          )}
          <div className="wz-menu-section wz-menu-links">
            <ExternalLink href={GITHUB_ISSUES_URL} className="">
              Report a problem on GitHub
            </ExternalLink>
            <ExternalLink href={GITHUB_SECURITY_URL} className="">
              Report a security issue
            </ExternalLink>
          </div>
        </div>
      )}
    </div>
  );
}
