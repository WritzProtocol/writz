"use client";

import { config } from "@/config";
import { withdrawable } from "@/lib/funds/model";
import type { Read } from "@/lib/loan/model";
import { networkName } from "@/lib/wallet/precheck";
import { ExternalLink, Notice } from "@/components/ui";
import { LENDING_DOCS_URL } from "@/lib/links";
import { Enter } from "@/components/ui/entrance";
import { FundsCard, NotConnected } from "@/components/funds/FundsCard";
import { Hero, RiskNotes, Tile, Tiles } from "@/components/funds/parts";
import { balanceCaption, balanceDecimals, formatApr, poolSupplyRate, type LendModel } from "./model";

const STELLAR = networkName(config.networkPassphrase);

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function SupplyRate({ pool }: { pool: LendModel["pool"] }) {
  return (
    <div>
      <dt>Supply rate</dt>
      <dd className="fu-tile-v">
        {pool.kind === "ok" ? (
          <span className="mono">{formatApr(poolSupplyRate(pool.value))}</span>
        ) : pool.kind === "failed" ? (
          <span className="fu-na">Unavailable</span>
        ) : (
          <>
            <span className="wz-skeleton fu-sk" aria-hidden="true" />
            <span className="wz-sr">Checking...</span>
          </>
        )}
      </dd>
      <dd className="fu-caption">Variable APR.</dd>
    </div>
  );
}

export function LendView({ m }: { m: LendModel }) {
  const blocked = m.wrongNetwork !== null || m.unfunded;
  const available: Read<bigint> = m.pool.kind === "ok" ? { kind: "ok", value: m.pool.value.available } : m.pool;
  const out = m.balance.kind === "ok" && m.pool.kind === "ok" ? withdrawable(m.balance.value, m.pool.value.available) : null;

  return (
    <div className="fu-page">
      <Enter as="header" name="head">
        <h1 className="fu-h1">Lend USDC</h1>
        <p className="fu-lede">Supply USDC to the lending pool and earn interest from borrowers. The rate moves with how much of the pool is borrowed. Stellar testnet, test USDC.</p>
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
            <p>Can&apos;t load your pool balance right now. Your funds are not affected. Last updated {clock(m.stale.at)}.</p>
          </Notice>
        </div>
      ) : null}

      <div className="fu-grid">
        <section className="fu-figures" aria-label="Your position and the pool">
          {m.connected ? (
            <>
              <Hero
                label="Your balance"
                value={m.balance}
                unit="USDC"
                decimals={m.balance.kind === "ok" && m.balance.value > 0n ? balanceDecimals(m.pool) : 2}
                caption={balanceCaption(m.supplied, m.pool)}
              />
              <Tiles>
                <SupplyRate pool={m.pool} />
                <Tile label="Available in pool" value={available} />
                {out?.limitedByPool ? <Tile label="You can withdraw now" value={{ kind: "ok", value: out.stroops }} /> : null}
              </Tiles>
            </>
          ) : (
            <>
              <Hero label="Available in pool" value={available} unit="USDC" />
              <Tiles>
                <SupplyRate pool={m.pool} />
                <Tile
                  label="Supplied by lenders"
                  value={m.pool.kind === "ok" ? { kind: "ok", value: m.pool.value.totalSupplied } : m.pool}
                />
              </Tiles>
            </>
          )}
          <RiskNotes
            lines={[
              <ExternalLink key="docs" href={LENDING_DOCS_URL} className="wz-link fu-textlink">
                How lending works
              </ExternalLink>,
            ]}
            link={{ href: "/protocol", label: "See pool stats" }}
          />
        </section>

        <Enter name="act" step={3} className="fu-act">
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
        </Enter>
      </div>
    </div>
  );
}
