"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { btcTxUrl, stellarTxUrl } from "@/lib/explorer";
import { shortAddress } from "@/lib/borrow/journey";
import { loanHref, shortDate } from "@/lib/loan/model";
import { pickUrgent } from "@/lib/home/model";
import { trayItems, unsettledCount, type TrayItem } from "@/lib/tray";
import { useRefreshStatus } from "@/lib/status/provider";
import { ExternalLink } from "@/components/ui";
import { useShellAccount, type ShellAccount } from "./account";

export function useTray(): { items: TrayItem[]; count: number } {
  const a = useShellAccount();
  const [now] = useState(() => Date.now());
  const items = useMemo(
    () =>
      trayItems({
        pendingDeposit: a.pendingDeposit,
        depositStatus: a.deposit?.derived.status ?? null,
        pendingTxs: a.pendingTxs,
        recent: a.recent,
        now,
      }),
    [a.pendingDeposit, a.deposit, a.pendingTxs, a.recent, now],
  );
  return { items, count: unsettledCount(items) };
}

function time(at: number | null): string | null {
  if (at === null) return null;
  const d = new Date(at);
  return `${shortDate(at)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ActionNeeded({ a, onNavigate }: { a: ShellAccount; onNavigate: () => void }) {
  const urgent = pickUrgent(a.loanStatuses, null);
  const lines: { key: string; text: string; href?: string; action?: () => void; label: string }[] = [];
  if (a.stellar.address && a.loans.state === "failed") {
    lines.push({ key: "find", text: "Your loans couldn't be loaded.", action: a.loans.retry, label: "Find my loans" });
  }
  if (urgent?.kind === "liquidatable" || urgent?.kind === "at_risk") {
    const n = urgent.loan.position.index;
    const text = urgent.kind === "liquidatable" ? `Loan ${n + 1} can be liquidated now.` : `Loan ${n + 1} is close to liquidation.`;
    lines.push({ key: "risk", text, href: loanHref(n, "repay"), label: "Repay" });
  } else if (urgent?.kind === "repaid") {
    const n = urgent.loan.position.index;
    lines.push({ key: "release", text: `Loan ${n + 1} is repaid. Your BTC is still locked.`, href: loanHref(n, "release"), label: "Release BTC" });
  } else if (urgent?.kind === "deposit" && urgent.loan) {
    lines.push({ key: "finish", text: "One step is left to finish your deposit.", href: "/borrow/new", label: "Finish deposit" });
  } else if (urgent?.kind === "reclaimable") {
    const n = urgent.loan.position.index;
    lines.push({ key: "reclaim", text: `Loan ${n + 1} can be reclaimed without Writz.`, href: loanHref(n), label: "Open loan" });
  }
  if (lines.length === 0) return null;
  return (
    <section className="tr-group" aria-labelledby="tr-action">
      <h3 id="tr-action" className="wz-label">
        Action needed
      </h3>
      <ul className="tr-list">
        {lines.map((l) => (
          <li key={l.key} className="tr-item" data-state="needs_attention">
            <p className="tr-label">{l.text}</p>
            {l.href ? (
              <Link href={l.href} className="wz-btn wz-btn-gold wz-btn-sm" onClick={onNavigate}>
                {l.label}
              </Link>
            ) : (
              <button type="button" className="wz-btn wz-btn-gold wz-btn-sm" onClick={l.action}>
                {l.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Item({ item, onNavigate, checkAgain }: { item: TrayItem; onNavigate: () => void; checkAgain: () => void }) {
  const url = item.hash ? (item.chain === "bitcoin" ? btcTxUrl(item.hash) : stellarTxUrl(item.hash)) : null;
  return (
    <li className="tr-item" data-state={item.state}>
      <div className="tr-main">
        <p className="tr-label">
          {item.label}
          {item.loan ? <span className="wz-muted"> on {item.loan}</span> : null}
        </p>
        <span className="tr-chip" data-state={item.state}>
          <i aria-hidden="true" />
          {item.stateLabel}
        </span>
      </div>
      <p className="tr-meta">
        <span>{item.chain === "bitcoin" ? "Bitcoin" : "Stellar"}</span>
        {time(item.at) ? <span>{time(item.at)}</span> : null}
        {url && item.hash ? (
          <ExternalLink href={url} className="wz-link mono">
            {shortAddress(item.hash, 6, 6)}
          </ExternalLink>
        ) : null}
      </p>
      {item.action === "resume" ? (
        <Link href="/borrow/new" className="wz-btn wz-btn-line wz-btn-sm" onClick={onNavigate}>
          Resume
        </Link>
      ) : item.action === "check_again" ? (
        <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={checkAgain}>
          Check again
        </button>
      ) : null}
    </li>
  );
}

export function ActivityTrayBody({ onNavigate }: { onNavigate: () => void }) {
  const a = useShellAccount();
  const { items } = useTray();
  const refresh = useRefreshStatus();
  const hasDone = items.some((i) => i.state === "done");
  const checkAgain = () => {
    if (a.pendingDeposit) refresh({ position: null, pendingDeposit: a.pendingDeposit });
  };

  return (
    <div className="sh-sections">
      <ActionNeeded a={a} onNavigate={onNavigate} />
      <section className="tr-group" aria-label="Transactions">
        {items.length === 0 ? (
          <p className="wz-hint">Nothing in progress on this device.</p>
        ) : (
          <ul className="tr-list">
            {items.map((i) => (
              <Item key={i.key} item={i} onNavigate={onNavigate} checkAgain={checkAgain} />
            ))}
          </ul>
        )}
        {hasDone ? (
          <button type="button" className="wz-btn wz-btn-text" onClick={a.clearFinished}>
            Clear finished
          </button>
        ) : null}
      </section>
    </div>
  );
}
