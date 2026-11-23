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
import * as ui from "@/components/ui/styles";
import { NAV_INTEGRATIONS, NAV_MAIN, currentNav, type NavId } from "./nav";

const STELLAR = networkName(config.networkPassphrase);

const ICONS: Record<NavId, typeof House> = {
  home: House,
  borrow: CircleArrowDown,
  earn: Sprout,
  lend: Landmark,
  protocol: ChartNoAxesColumn,
};

type Open = "account" | "activity" | null;

const navLink =
  "relative isolate flex items-center gap-3 min-h-[46px] pr-3 pl-[22px] text-body text-[15px] font-medium leading-none no-underline transition-[color] duration-micro ease-enter motion-reduce:transition-none [&_svg]:flex-none hover:text-heading aria-[current=page]:text-heading focus-visible:outline-none after:absolute after:inset-y-0 after:inset-x-1.5 after:-z-1 after:-skew-x-16 after:transition-[background-color] after:duration-micro after:ease-enter motion-reduce:after:transition-none hover:after:bg-tint-10 aria-[current=page]:after:bg-tint-10 focus-visible:after:[box-shadow:0_0_0_2px_var(--bg),0_0_0_4px_var(--mark)] aria-[current=page]:before:absolute aria-[current=page]:before:left-[11px] aria-[current=page]:before:top-1/2 aria-[current=page]:before:w-1.5 aria-[current=page]:before:h-[14px] aria-[current=page]:before:-mt-[7px] aria-[current=page]:before:bg-mark aria-[current=page]:before:-skew-x-16";
const railSep = "h-px my-[14px] mx-[10px] bg-line";
const railNav = "flex flex-col gap-0.5";
const tab =
  "relative flex flex-col items-center justify-center gap-1 min-h-11 text-muted text-[13px] font-medium leading-[1.2] no-underline touch-manipulation select-none aria-[current=page]:text-heading focus-visible:outline-offset-[-4px] before:absolute before:top-1.5 before:left-1/2 before:w-4 before:h-[5px] before:-ml-2 before:-skew-x-16 aria-[current=page]:before:bg-mark [@media(max-height:480px)]:flex-row [@media(max-height:480px)]:gap-2 [@media(max-height:480px)]:before:top-1";
const nowrap = "whitespace-nowrap";

/** Left sidebar from 1024px; below it a compact header and bottom tabs. Activity and wallets sit top right in both. */
export function AppNav() {
  const pathname = usePathname();
  const current = currentNav(pathname);
  const a = useShellAccount();
  const { count } = useTray();
  const [open, setOpen] = useState<Open>(null);
  const [left, setLeft] = useState(0);
  const dismissOn = `${pathname}:${left}`;
  const chip = useRef<HTMLButtonElement>(null);
  const tray = useRef<HTMLButtonElement>(null);

  const stellar = a.stellar.address;
  const btc = a.bitcoin.address;
  const any = Boolean(stellar || btc);
  const chipName = `Wallets: Stellar ${stellar ? "connected" : "not connected"}, Bitcoin ${btc ? "connected" : "not connected"}`;
  const aria = (id: NavId) => (current === id ? ("page" as const) : undefined);

  return (
    <>
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:flex-col lg:w-(--rail) lg:pt-[22px] lg:px-4 lg:pb-5 lg:overflow-y-auto lg:border-r lg:border-line lg:bg-bg">
        <Link href="/" className="inline-flex self-start pt-[9px] px-[10px] pb-[30px] focus-visible:outline-offset-[-2px]" aria-label="Writz home">
          <span
            className="block w-[92px] h-[26px] bg-heading [mask:url(/brand/writz-lockup.svg)_no-repeat_left_center/contain] flex-none"
            aria-hidden="true"
          />
        </Link>
        <nav aria-label="Main" className={railNav}>
          {NAV_MAIN.map(({ id, label, href }) => {
            const Icon = ICONS[id];
            return (
              <Link key={id} href={href} className={navLink} aria-current={aria(id)}>
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
          <div className={railSep} role="presentation" />
          <Link href="/protocol" className={navLink} aria-current={aria("protocol")}>
            <ChartNoAxesColumn size={20} strokeWidth={1.75} aria-hidden="true" />
            Protocol
          </Link>
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={navLink}>
            <BookOpen size={20} strokeWidth={1.75} aria-hidden="true" />
            Docs
            <span className="sr-only"> (opens in a new tab)</span>
            <ExternalLink size={16} strokeWidth={1.75} className="ml-auto text-muted" aria-hidden="true" />
          </a>
        </nav>
        {NAV_INTEGRATIONS.length > 0 ? (
          <nav aria-labelledby="rail-integrations" className={railNav}>
            <div className={railSep} role="presentation" />
            <p id="rail-integrations" className="mr-[10px] mb-1.5 ml-[22px] text-[12px] font-medium tracking-[0.06em] uppercase text-muted">
              Integrations
            </p>
            {NAV_INTEGRATIONS.map(({ id, label, href }) => {
              const Icon = ICONS[id];
              return (
                <Link key={id} href={href} className={navLink} aria-current={aria(id)}>
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </nav>
        ) : null}
        {config.target === "mainnet" ? null : (
          <p className="mt-auto pt-6 px-[10px] text-[13px] leading-normal text-muted">
            {STELLAR} and {BTC_NETWORK_LABEL}. Test funds only.
          </p>
        )}
      </div>

      <header className="sticky top-0 z-10 bg-bg max-lg:[@media(max-height:480px)]:relative">
        <div className="flex items-center gap-2 h-[76px] px-(--gut) max-lg:h-16">
          <Link href="/" className="hidden items-center min-h-11 min-w-11 max-lg:inline-flex" aria-label="Writz home">
            <span
              className="block w-[35px] h-6 bg-heading [mask:url(/brand/writz-mark.svg)_no-repeat_left_center/contain] flex-none"
              aria-hidden="true"
            />
          </Link>
          <div className="flex items-center gap-2 ml-auto max-lg:gap-1">
            <span className={ui.cx(ui.tag, "max-lg:hidden")}>{STELLAR}</span>
            <button
              ref={tray}
              type="button"
              className={ui.cx(ui.btn("quiet", "sm"), nowrap, "max-lg:w-14")}
              aria-label={count > 0 ? `Activity, ${count} in progress` : "Activity"}
              aria-haspopup="dialog"
              aria-expanded={open === "activity"}
              onClick={() => setOpen("activity")}
            >
              <Activity size={18} aria-hidden="true" />
              <span className="max-lg:hidden">Activity</span>
              {count > 0 ? (
                <span
                  className="relative isolate inline-grid place-items-center min-w-6 h-5 px-[7px] text-on-accent text-[13px] font-semibold leading-none max-lg:absolute max-lg:top-0 max-lg:right-0 before:absolute before:inset-y-0 before:inset-x-0.5 before:-z-1 before:bg-accent before:-skew-x-16"
                  aria-hidden="true"
                >
                  {count}
                </span>
              ) : null}
            </button>
            {a.walletsKnown ? (
              <button
                ref={chip}
                type="button"
                className={ui.cx(ui.btn(any ? "quiet" : "line", "sm"), nowrap)}
                aria-haspopup="dialog"
                aria-expanded={open === "account"}
                aria-label={any ? chipName : undefined}
                onClick={() => setOpen("account")}
              >
                {any ? (
                  <>
                    <i className={ui.dot} data-on={Boolean(btc)} aria-hidden="true" />
                    <i className={ui.dot} data-on={Boolean(stellar)} aria-hidden="true" />
                    <span className="mono text-[14px] text-heading">{stellar ? shortAddress(stellar) : btc ? shortAddress(btc) : ""}</span>
                  </>
                ) : (
                  "Connect wallets"
                )}
              </button>
            ) : (
              <span className={ui.cx(ui.btn("quiet", "sm"), nowrap, ui.skFill)} aria-hidden="true">
                <i className={ui.cx(ui.dot, "invisible")} />
                <i className={ui.cx(ui.dot, "invisible")} />
                <span className="mono text-[14px] text-heading invisible">GABC…WXYZ</span>
              </span>
            )}
          </div>
        </div>
      </header>

      <nav
        className="hidden max-lg:fixed max-lg:inset-x-0 max-lg:top-auto max-lg:bottom-0 max-lg:z-10 max-lg:grid max-lg:grid-cols-[repeat(4,1fr)] max-lg:h-[calc(64px+env(safe-area-inset-bottom))] max-lg:pb-[env(safe-area-inset-bottom)] max-lg:border-t max-lg:border-line max-lg:bg-surface max-lg:[@media(max-height:480px)]:h-[calc(52px+env(safe-area-inset-bottom))] max-lg:pointer-coarse:group-has-[:is(input:not([type=checkbox],[type=radio],[type=file],[type=range]),textarea):focus]/app:hidden"
        aria-label="Main"
      >
        {NAV_MAIN.map(({ id, label, href }) => {
          const Icon = ICONS[id];
          return (
            <Link key={id} href={href} className={tab} aria-current={aria(id)}>
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {open === "account" ? (
        <Sheet title="Wallets" subtitle={`${STELLAR} and ${BTC_NETWORK_LABEL}`} onClose={() => setOpen(null)} returnFocus={chip} dismissOn={dismissOn}>
          <AccountSheetBody />
        </Sheet>
      ) : null}
      {open === "activity" ? (
        <Sheet
          title="Activity on this device"
          subtitle="Transactions from this browser. Your loans load from your Stellar wallet on any device."
          onClose={() => setOpen(null)}
          returnFocus={tray}
          dismissOn={dismissOn}
        >
          <ActivityTrayBody onNavigate={() => setLeft((n) => n + 1)} />
        </Sheet>
      ) : null}
    </>
  );
}
