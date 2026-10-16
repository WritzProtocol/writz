"use client";

import { config } from "@/config";
import { networkName } from "@/lib/wallet/precheck";
import { ExternalLink, Notice } from "@/components/ui";
import { Enter } from "@/components/ui/entrance";
import { FundsCard, NotConnected } from "@/components/funds/FundsCard";
import { Hero, RiskNotes, Tile, Tiles } from "@/components/funds/parts";
import { PAUSED, UNIT, type EarnModel } from "./model";

const STELLAR = networkName(config.networkPassphrase);

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Apy({ apy }: { apy: EarnModel["apy"] }) {
  return (
    <div>
      <dt>APY</dt>
      {apy.value !== null ? (
        <>
          <dd className="fu-tile-v">
            <span className="mono">{(apy.value * 100).toFixed(2)}%</span>
          </dd>
          <dd className="fu-caption">
            Earned from Blend lending. Changes over time.
            {apy.at !== null ? <> Updated {clock(apy.at)}.</> : null}
          </dd>
        </>
      ) : (
        <dd className="fu-caption">{apy.failed ? "APY unavailable right now." : "Reading the APY..."}</dd>
      )}
    </div>
  );
}

export function EarnView({ m }: { m: EarnModel }) {
  const blocked = m.wrongNetwork !== null || m.unfunded;
  const balance = m.stale ? { kind: "ok" as const, value: m.stale.value } : m.balance;
  return (
    <div className="fu-page">
      <Enter as="header" name="head">
        <h1 className="fu-h1">Earn on USDC</h1>
        <p className="fu-lede">
          Deposit Blend test USDC into the Writz vault on DeFindex. It earns from Blend lending. Shares sit in your own wallet.
        </p>
      </Enter>

      {m.stale ? (
        <div className="fu-stale">
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
        </div>
      ) : null}

      <div className="fu-grid">
        <section className="fu-figures" aria-label="Your vault">
          {m.connected ? (
            <Hero
              label="Your balance"
              value={balance}
              unit={UNIT}
              caption={m.balance.kind === "ok" && m.balance.value === 0n ? "Nothing in the vault yet." : undefined}
            />
          ) : null}
          <Tiles>
            {m.connected && m.earned !== null ? <Tile label="Earned so far" value={{ kind: "ok", value: m.earned }} unit={UNIT} /> : null}
            <Apy apy={m.apy} />
          </Tiles>
          <RiskNotes
            lines={["Blend test USDC is a different asset from the USDC you borrow.", "The vault carries Blend's lending risk."]}
            link={{ href: "/protocol", label: "See vault stats" }}
          />
        </section>

        <Enter name="act" step={3} className="fu-act">
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
        </Enter>
      </div>
    </div>
  );
}
