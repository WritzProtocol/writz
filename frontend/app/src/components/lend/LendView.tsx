"use client";

import Link from "next/link";
import { config } from "@/config";
import { withdrawable } from "@/lib/funds/model";
import type { Read } from "@/lib/loan/model";
import { networkName } from "@/lib/wallet/precheck";
import { Notice } from "@/components/redesign/ui";
import { FundsCard, NotConnected, Stat } from "@/components/funds/FundsCard";
import type { LendModel } from "./model";

const STELLAR = networkName(config.networkPassphrase);

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function LendView({ m }: { m: LendModel }) {
  const blocked = m.wrongNetwork !== null || m.unfunded;
  const available: Read<bigint> = m.pool.kind === "ok" ? { kind: "ok", value: m.pool.value.available } : m.pool;
  const canWithdraw: Read<bigint> =
    m.supplied.kind === "ok" && m.pool.kind === "ok"
      ? { kind: "ok", value: withdrawable(m.supplied.value, m.pool.value.available).stroops }
      : m.supplied.kind === "failed" || m.pool.kind === "failed"
        ? { kind: "failed" }
        : { kind: "checking" };

  return (
    <div className="fu-col">
      <header className="hm-head">
        <h1 className="hm-h1">Lend USDC</h1>
        <p className="hm-sub">Supply USDC to the pool borrowers draw from. You can withdraw what you supplied.</p>
      </header>

      <section className="fu-summary" aria-label="The pool">
        <dl className="fu-stats">
          {m.connected ? (
            <>
              <Stat
                label="You supplied, USDC"
                value={m.supplied}
                caption={m.supplied.kind === "ok" && m.supplied.value === 0n ? "You haven't supplied any USDC." : undefined}
              />
              <Stat label="Available in pool, USDC" value={available} />
              <Stat label="You can withdraw now, USDC" value={canWithdraw} />
            </>
          ) : (
            <>
              <Stat label="Available in pool, USDC" value={available} />
              <Stat label="Supplied by lenders, USDC" value={m.pool.kind === "ok" ? { kind: "ok", value: m.pool.value.totalSupplied } : m.pool} />
            </>
          )}
        </dl>
      </section>

      {m.stale ? (
        <Notice
          tone="warning"
          label="Balance not refreshed"
          actions={
            <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={m.retry}>
              Try again
            </button>
          }
        >
          <p>Can&apos;t load your pool balance right now. Your funds are not affected. Last updated {clock(m.stale.at)}.</p>
        </Notice>
      ) : null}

      {!m.connected ? (
        <NotConnected text="Connect your Stellar wallet to lend USDC." connect={m.connect} connecting={m.connecting} />
      ) : m.wrongNetwork ? (
        <Notice tone="warning" label="Wrong network">
          <p>
            Your wallet is on {m.wrongNetwork}. Writz runs on {STELLAR}. Switch network in {m.walletName}.
          </p>
        </Notice>
      ) : m.unfunded ? (
        <Notice tone="warning" label="Account not funded">
          <p>This account has no test XLM yet, so it can&apos;t pay network fees. Fund it from the Wallets menu.</p>
        </Notice>
      ) : null}

      {m.funds && !blocked ? <FundsCard m={m.funds} label="Supply or withdraw" /> : null}

      <div className="fu-notes">
        <p>Suppliers carry Bitcoin credit risk. When borrowers are using the pool, you may have to wait to withdraw.</p>
        <Link href="/protocol" className="wz-link">
          See pool stats
        </Link>
      </div>
    </div>
  );
}
