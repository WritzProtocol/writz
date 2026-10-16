"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Activity, BookOpen, ChartNoAxesColumn, CircleArrowDown, ExternalLink, House, Landmark, Sprout } from "lucide-react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { networkName } from "@/lib/wallet/precheck";
import { shortAddress } from "@/lib/borrow/journey";
import { DOCS_URL } from "@/lib/links";
import { useShellAccount } from "@/components/shell/account";
import { Sheet } from "@/components/shell/Sheet";
import { AccountSheetBody } from "@/components/shell/AccountSheet";
import { ActivityTrayBody, useTray } from "@/components/shell/ActivityTray";
import { NAV_MAIN, currentNav, type NavId } from "./nav";

const STELLAR = networkName(config.networkPassphrase);

const ICONS: Record<NavId, typeof House> = {
  home: House,
  borrow: CircleArrowDown,
  earn: Sprout,
  lend: Landmark,
  protocol: ChartNoAxesColumn,
};

type Open = "account" | "activity" | null;

/** Left sidebar from 1024px; below it a compact header and bottom tabs. Activity and wallets sit top right in both. */
export function AppNav() {
  const pathname = usePathname();
  const current = currentNav(pathname);
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
  const aria = (id: NavId) => (current === id ? ("page" as const) : undefined);

  return (
    <>
      <div className="wz-rail">
        <Link href="/" className="wz-rail-home" aria-label="Writz home">
          <span className="wz-lockup" aria-hidden="true" />
        </Link>
        <nav aria-label="Main">
          {NAV_MAIN.map(({ id, label, href }) => {
            const Icon = ICONS[id];
            return (
              <Link key={id} href={href} className="wz-navlink" aria-current={aria(id)}>
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
          <div className="wz-rail-sep" role="presentation" />
          <Link href="/protocol" className="wz-navlink" aria-current={aria("protocol")}>
            <ChartNoAxesColumn size={20} strokeWidth={1.75} aria-hidden="true" />
            Protocol
          </Link>
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="wz-navlink">
            <BookOpen size={20} strokeWidth={1.75} aria-hidden="true" />
            Docs
            <span className="wz-sr"> (opens in a new tab)</span>
            <ExternalLink size={16} strokeWidth={1.75} className="wz-navlink-ext" aria-hidden="true" />
          </a>
        </nav>
        {config.target === "mainnet" ? null : (
          <p className="wz-rail-foot">
            {STELLAR} and {BTC_NETWORK_LABEL}. Test funds only.
          </p>
        )}
      </div>

      <header className="wz-top">
        <div className="wz-top-inner">
          <Link href="/" className="wz-top-home" aria-label="Writz home">
            <span className="wz-mark" aria-hidden="true" />
          </Link>
          <div className="wz-top-end">
            <span className="wz-tag wz-net">{STELLAR}</span>
            <button
              ref={tray}
              type="button"
              className="wz-btn wz-btn-quiet wz-btn-sm wz-activity"
              aria-label={count > 0 ? `Activity, ${count} in progress` : "Activity"}
              aria-haspopup="dialog"
              aria-expanded={open === "activity"}
              onClick={() => setOpen("activity")}
            >
              <Activity size={18} aria-hidden="true" />
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
              className={`wz-btn wz-btn-sm wz-wallet-chip ${any ? "wz-btn-quiet" : "wz-btn-line"}`}
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
        {NAV_MAIN.map(({ id, label, href }) => {
          const Icon = ICONS[id];
          return (
            <Link key={id} href={href} aria-current={aria(id)}>
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
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
