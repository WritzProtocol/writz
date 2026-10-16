"use client";

import { config } from "@/config";
import { withdrawable } from "@/lib/funds/model";
import type { Read } from "@/lib/loan/model";
import { networkName } from "@/lib/wallet/precheck";
import { Notice } from "@/components/redesign/ui";
import { FundsCard, NotConnected } from "@/components/funds/FundsCard";
import { Hero, RiskNotes, Tile, Tiles } from "@/components/funds/parts";
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
    <div className="fu-page">
      <header>
        <h1 className="fu-h1">Lend USDC</h1>
        <p className="fu-lede">Supply USDC to the pool borrowers draw from. You can withdraw what you supplied.</p>
      </header>

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
                label="You supplied"
                value={m.supplied}
                unit="USDC"
                caption={m.supplied.kind === "ok" && m.supplied.value === 0n ? "You haven't supplied any USDC." : undefined}
              />
              <Tiles>
                <Tile label="Available in pool" value={available} />
                <Tile label="You can withdraw now" value={canWithdraw} />
              </Tiles>
            </>
          ) : (
            <>
              <Hero label="Available in pool" value={available} unit="USDC" />
              <Tiles>
                <Tile
                  label="Supplied by lenders"
                  value={m.pool.kind === "ok" ? { kind: "ok", value: m.pool.value.totalSupplied } : m.pool}
                />
              </Tiles>
            </>
          )}
          <RiskNotes
            lines={["Suppliers carry Bitcoin credit risk. When borrowers are using the pool, you may have to wait to withdraw."]}
            link={{ href: "/protocol", label: "See pool stats" }}
          />
        </section>

        <div className="fu-act">
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
        </div>
      </div>
    </div>
  );
}
