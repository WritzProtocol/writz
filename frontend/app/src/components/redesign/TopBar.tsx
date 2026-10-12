"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Activity, ArrowUpRight, HandCoins, House, Landmark, Sprout } from "lucide-react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { networkName } from "@/lib/wallet/precheck";
import { shortAddress } from "@/lib/borrow/journey";
import { DOCS_URL } from "@/lib/links";
import { useShellAccount } from "@/components/shell/account";
import { Sheet } from "@/components/shell/Sheet";
import { AccountSheetBody } from "@/components/shell/AccountSheet";
import { ActivityTrayBody, useTray } from "@/components/shell/ActivityTray";

const STELLAR = networkName(config.networkPassphrase);

const TABS = [
  { label: "Home", href: "/", icon: House },
  { label: "Borrow", href: "/borrow/new", icon: HandCoins },
  { label: "Earn", href: "/earn", icon: Sprout },
  { label: "Lend", href: "/lend", icon: Landmark },
];

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/borrow/new") return pathname.startsWith("/borrow") || pathname.startsWith("/loans");
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Open = "account" | "activity" | null;

export function TopBar() {
  const pathname = usePathname();
  const a = useShellAccount();
  const { count } = useTray();
  const [open, setOpen] = useState<Open>(null);
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setOpen(null);
  }
  const chip = useRef<HTMLButtonElement>(null);
  const tray = useRef<HTMLButtonElement>(null);

  const stellar = a.stellar.address;
  const btc = a.bitcoin.address;
  const any = Boolean(stellar || btc);
  const chipName = `Wallets: Stellar ${stellar ? "connected" : "not connected"}, Bitcoin ${btc ? "connected" : "not connected"}`;

  return (
    <>
      <header className="wz-top">
        <div className="wz-top-inner">
          <Link href="/" className="wz-lockup" aria-label="Writz home" />
          <nav className="wz-nav" aria-label="Main">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} aria-current={isCurrent(pathname, t.href) ? "page" : undefined}>
                {t.label}
              </Link>
            ))}
            <Link href="/protocol" className="wz-nav-wide" aria-current={pathname === "/protocol" ? "page" : undefined}>
              Protocol
            </Link>
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="wz-nav-wide">
              Docs
              <ArrowUpRight size={14} aria-hidden="true" />
              <span className="wz-sr"> (opens in a new tab)</span>
            </a>
          </nav>
          <div className="wz-top-end">
            <span className="wz-pill">{STELLAR}</span>
            <button
              ref={tray}
              type="button"
              className="wz-chip wz-activity"
              aria-label={count > 0 ? `Activity, ${count} in progress` : "Activity"}
              aria-haspopup="dialog"
              aria-expanded={open === "activity"}
              onClick={() => setOpen("activity")}
            >
              <Activity size={16} aria-hidden="true" />
              <span className="wz-activity-label">Activity</span>
              {count > 0 ? (
                <span className="wz-count" aria-hidden="true">
                  {count}
                </span>
              ) : null}
            </button>
            <button
              ref={chip}
              type="button"
              className="wz-chip"
              data-empty={!any}
              aria-haspopup="dialog"
              aria-expanded={open === "account"}
              aria-label={any ? chipName : undefined}
              onClick={() => setOpen("account")}
            >
              {any ? (
                <>
                  <i className="wz-dot" data-on={Boolean(btc)} aria-hidden="true" />
                  <i className="wz-dot" data-on={Boolean(stellar)} aria-hidden="true" />
                  <span className="mono">{stellar ? shortAddress(stellar) : btc ? shortAddress(btc) : ""}</span>
                </>
              ) : (
                "Connect wallets"
              )}
            </button>
          </div>
        </div>
      </header>

      <nav className="wz-tabs" aria-label="Main">
        {TABS.map(({ label, href, icon: Icon }) => (
          <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? "page" : undefined}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      {open === "account" ? (
        <Sheet title="Wallets" subtitle={`${STELLAR} and ${BTC_NETWORK_LABEL}`} onClose={() => setOpen(null)} returnFocus={chip}>
          <AccountSheetBody />
        </Sheet>
      ) : null}
      {open === "activity" ? (
        <Sheet
          title="Activity on this device"
          subtitle="Transactions from this browser. Your loans load from your Stellar wallet on any device."
          onClose={() => setOpen(null)}
          returnFocus={tray}
        >
          <ActivityTrayBody onNavigate={() => setOpen(null)} />
        </Sheet>
      ) : null}
    </>
  );
}
