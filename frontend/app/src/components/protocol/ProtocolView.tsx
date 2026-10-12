"use client";

import { useState, type ReactNode } from "react";
import { config } from "@/config";
import { formatUsdc, shortAddress } from "@/lib/borrow/journey";
import { analyzeCohort } from "@/lib/metrics/cohort";
import type { RetentionCohort } from "@/lib/metrics/api";
import { networkName } from "@/lib/wallet/precheck";
import { ExternalLink } from "@/components/redesign/ui";
import { useMockWorld } from "@/components/redesign/hooks";
import { mockProtocolData, type ProtocolData } from "./model";

const STELLAR = networkName(config.networkPassphrase);
// Fixed testnet address; source of truth is contracts/deployments/defindex-vault-testnet.md.
const VAULT_CONTRACT = "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S";

const contractUrl = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function Unavailable() {
  return <p className="wz-hint">Unavailable right now. Refresh in a minute.</p>;
}

function Block({ title, at, children }: { title: string; at: number; children: ReactNode }) {
  const id = `pr-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="pr-block" aria-labelledby={id}>
      <div className="wz-spread">
        <h2 id={id} className="hm-h2">
          {title}
        </h2>
        <span className="wz-hint">Updated {clock(at)}</span>
      </div>
      {children}
    </section>
  );
}

function Figure({ label, value, unit, text }: { label: string; value: string; unit?: string; text?: boolean }) {
  return (
    <div className="fu-stat">
      <dt>{label}</dt>
      <dd className={text ? undefined : "mono"}>
        {value}
        {unit ? <span className="wz-muted"> {unit}</span> : null}
      </dd>
    </div>
  );
}

function Retention({ cohorts, now }: { cohorts: RetentionCohort[]; now: number }) {
  if (cohorts.length === 0) return <p className="wz-hint">No deposit cohorts yet.</p>;
  return (
    <table className="pr-table">
      <thead>
        <tr>
          <th scope="col">First deposit</th>
          <th scope="col">Depositors</th>
          <th scope="col">Past 30 days</th>
          <th scope="col">Still in the vault</th>
          <th scope="col">Retention</th>
        </tr>
      </thead>
      <tbody>
        {cohorts.map((c) => {
          const a = analyzeCohort(c, new Date(now));
          return (
            <tr key={c.cohort}>
              <th scope="row" data-label="First deposit" className="mono">
                {c.cohort}
              </th>
              <td data-label="Depositors" className="mono">
                {c.depositors}
              </td>
              <td data-label="Past 30 days" className="mono">
                {a.eligible}
              </td>
              <td data-label="Still in the vault" className="mono">
                {a.retained}
              </td>
              <td data-label="Retention">
                {a.isFullySeasoned && a.retentionPercent !== null ? (
                  <span className="pr-ret">
                    <span className="pr-bar" aria-hidden="true">
                      <span style={{ width: `${a.retentionPercent}%` }} />
                    </span>
                    <span className="mono">{a.retentionPercent}%</span>
                  </span>
                ) : (
                  <span className="pr-ret">
                    <span className="pr-bar" data-partial="true" aria-hidden="true">
                      <span style={{ width: `${(a.seasoningDays / 30) * 100}%` }} />
                    </span>
                    <span>Under 30 days (day {a.seasoningDays})</span>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const CONTRACTS = [
  { label: "Commitment tree", id: config.contracts.commitmentTree },
  { label: "Private lend", id: config.contracts.privateLend },
  { label: "Bitcoin SPV", id: config.contracts.bitcoinSpv },
  { label: "ZK verifier", id: config.contracts.zkVerifier },
  { label: "USDC token", id: config.contracts.usdcToken },
  { label: "Earn vault (DeFindex)", id: VAULT_CONTRACT },
].filter((c) => c.id);

export function ProtocolView({ data: server }: { data: ProtocolData }) {
  const world = useMockWorld();
  const [now] = useState(() => Date.now());
  const d = world ? mockProtocolData(world, now) : server;
  const allFailed = d.pool.kind === "failed" && d.vault.kind === "failed";

  return (
    <div className="pr-col">
      <header className="hm-head">
        <h1 className="hm-h1">Protocol</h1>
        <p className="hm-sub">Live reads from {STELLAR}.</p>
      </header>

      {allFailed ? (
        <p className="wz-note" data-tone="warning">
          <span className="wz-note-label">Unavailable</span>
          <span>Can&apos;t read {STELLAR} right now. Refresh in a minute.</span>
        </p>
      ) : null}

      <Block title="Borrow pool" at={d.at}>
        {d.pool.kind === "ok" ? (
          <dl className="fu-stats">
            <Figure label="Available to borrow" value={formatUsdc(d.pool.value.available)} unit="USDC" />
            <Figure label="Supplied by lenders" value={formatUsdc(d.pool.value.totalSupplied)} unit="USDC" />
            <Figure label="Borrowed across all open loans" value={formatUsdc(d.pool.value.totalBorrowed)} unit="USDC" />
          </dl>
        ) : (
          <Unavailable />
        )}
      </Block>

      <Block title="Earn vault" at={d.at}>
        {d.vault.kind === "ok" ? (
          <>
            <dl className="fu-stats">
              <Figure label="Total in vault" value={formatUsdc(d.vault.value.totalStroops)} unit="USDC (Blend)" />
              <Figure label="Depositors" value={String(d.vault.value.depositors)} />
              <Figure label="APY" value={d.vault.value.apy !== null ? `${(d.vault.value.apy * 100).toFixed(2)}%` : "Unavailable"} />
              <Figure label="Strategy" value="Blend lending pool" text />
            </dl>
            {d.vault.value.depositors === 0 ? <p className="wz-hint">No deposits yet.</p> : null}
          </>
        ) : (
          <Unavailable />
        )}
      </Block>

      <Block title="30-day retention" at={d.at}>
        <p className="wz-hint">Of the depositors who reached 30 days, how many still hold a balance in the vault.</p>
        {d.cohorts.kind === "ok" ? <Retention cohorts={d.cohorts.value} now={d.at} /> : <Unavailable />}
      </Block>

      <section className="pr-block" aria-labelledby="pr-contracts">
        <h2 id="pr-contracts" className="hm-h2">
          Contracts on {STELLAR}
        </h2>
        <dl className="pr-contracts">
          {CONTRACTS.map((c) => (
            <div key={c.label}>
              <dt>{c.label}</dt>
              <dd>
                <ExternalLink href={contractUrl(c.id)} className="wz-link mono">
                  {shortAddress(c.id, 8, 8)}
                </ExternalLink>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
