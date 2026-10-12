"use client";

import Link from "next/link";
import { config } from "@/config";
import { networkName } from "@/lib/wallet/precheck";
import { ExternalLink, Notice } from "@/components/redesign/ui";
import { FundsCard, NotConnected, Stat } from "@/components/funds/FundsCard";
import { PAUSED, UNIT, type EarnModel } from "./model";

const STELLAR = networkName(config.networkPassphrase);

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function EarnView({ m }: { m: EarnModel }) {
  const blocked = m.wrongNetwork !== null || m.unfunded;
  return (
    <div className="fu-col">
      <header className="hm-head">
        <h1 className="hm-h1">Earn on USDC</h1>
        <p className="hm-sub">
          Deposit Blend test USDC into the Writz vault on DeFindex. It earns from Blend lending. Shares sit in your own wallet.
        </p>
      </header>

      <section className="fu-summary" aria-label="Your vault">
        <p className="fu-apy">
          {m.apy.value !== null ? (
            <>
              <b className="mono">{(m.apy.value * 100).toFixed(2)}%</b> APY. Earned from Blend lending. Changes over time.
              {m.apy.at !== null ? <span className="wz-muted"> Updated {clock(m.apy.at)}.</span> : null}
            </>
          ) : m.apy.failed ? (
            "APY unavailable right now."
          ) : (
            "Reading the APY..."
          )}
        </p>
        {m.connected ? (
          <dl className="fu-stats">
            <Stat
              label={`Your balance, ${UNIT}`}
              value={m.stale ? { kind: "ok", value: m.stale.value } : m.balance}
              caption={m.balance.kind === "ok" && m.balance.value === 0n ? "Nothing in the vault yet." : undefined}
            />
            {m.earned !== null ? <Stat label={`Earned so far, ${UNIT}`} value={{ kind: "ok", value: m.earned }} /> : null}
          </dl>
        ) : null}
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
          <p>
            Can&apos;t load your vault balance right now. Your funds are not affected. This page retries on its own. Last
            updated {clock(m.stale.at)}.
          </p>
        </Notice>
      ) : null}

      {m.paused ? (
        <Notice tone="warning" label="Strategy paused">
          <p>{PAUSED}</p>
        </Notice>
      ) : null}

      {!m.connected ? (
        <NotConnected text="Connect a Stellar wallet to see your balance." connect={m.connect} connecting={m.connecting} />
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

      {m.funds && !blocked ? <FundsCard m={m.funds} label="Deposit or withdraw" /> : null}

      {m.connected && m.wallet.kind === "ok" && m.wallet.value === 0n && config.earn.faucetUrl ? (
        <p className="wz-hint">
          This vault uses Blend test USDC, a different asset from the USDC you borrow.{" "}
          <ExternalLink href={config.earn.faucetUrl}>Get some from the Blend faucet</ExternalLink>.
        </p>
      ) : null}

      <div className="fu-notes">
        <p>Blend test USDC is a different asset from the USDC you borrow.</p>
        <p>The vault carries Blend&apos;s lending risk.</p>
        <Link href="/protocol" className="wz-link">
          See vault stats
        </Link>
      </div>
    </div>
  );
}
