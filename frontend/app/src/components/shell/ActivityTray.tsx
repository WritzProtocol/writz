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
import * as ui from "@/components/ui/styles";
import { useShellAccount, type ShellAccount } from "./account";

const group = "flex flex-col gap-3 py-5 [*+&]:border-t [*+&]:border-line";
const list = "flex flex-col gap-1 m-0 p-0 list-none";
const itemBox =
  "flex flex-col items-start gap-2 p-[14px] bg-bg [box-shadow:inset_0_0_0_1px_var(--line)] data-[state=needs_attention]:[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--warning)_45%,transparent)]";
const itemLabel = "text-[15px] text-heading";

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
    <section className={group} aria-labelledby="tr-action">
      <h3 id="tr-action" className={ui.label}>
        Action needed
      </h3>
      <ul className={list}>
        {lines.map((l) => (
          <li key={l.key} className={itemBox} data-state="needs_attention">
            <p className={itemLabel}>{l.text}</p>
            {l.href ? (
              <Link href={l.href} className={ui.btn("gold", "sm")} onClick={onNavigate}>
                {l.label}
              </Link>
            ) : (
              <button type="button" className={ui.btn("gold", "sm")} onClick={l.action}>
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
    <li className={itemBox} data-state={item.state}>
      <div className="flex justify-between items-start gap-3 w-full">
        <p className={itemLabel}>
          {item.label}
          {item.loan ? <span className={ui.muted}> on {item.loan}</span> : null}
        </p>
        <span
          className="inline-flex items-center gap-2 text-[13px] font-medium whitespace-nowrap text-info data-[state=needs_attention]:text-warning data-[state=done]:text-positive [&_i]:w-1.5 [&_i]:h-[11px] [&_i]:bg-current [&_i]:-skew-x-16"
          data-state={item.state}
        >
          <i aria-hidden="true" />
          {item.stateLabel}
        </span>
      </div>
      <p className="flex flex-wrap gap-y-1 gap-x-3 text-[13px] text-muted">
        <span>{item.chain === "bitcoin" ? "Bitcoin" : "Stellar"}</span>
        {time(item.at) ? <span>{time(item.at)}</span> : null}
        {url && item.hash ? (
          <ExternalLink href={url} className={ui.cx(ui.monoLink, "text-[13px]")}>
            {shortAddress(item.hash, 6, 6)}
          </ExternalLink>
        ) : null}
      </p>
      {item.action === "resume" ? (
        <Link href="/borrow/new" className={ui.btn("line", "sm")} onClick={onNavigate}>
          Resume
        </Link>
      ) : item.action === "check_again" ? (
        <button type="button" className={ui.btn("line", "sm")} onClick={checkAgain}>
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
    <div className="flex flex-col">
      <ActionNeeded a={a} onNavigate={onNavigate} />
      <section className={group} aria-label="Transactions">
        {items.length === 0 ? (
          <p className={ui.hint}>Nothing in progress on this device.</p>
        ) : (
          <ul className={list}>
            {items.map((i) => (
              <Item key={i.key} item={i} onNavigate={onNavigate} checkAgain={checkAgain} />
            ))}
          </ul>
        )}
        {hasDone ? (
          <button type="button" className={ui.btn("text")} onClick={a.clearFinished}>
            Clear finished
          </button>
        ) : null}
      </section>
    </div>
  );
}
