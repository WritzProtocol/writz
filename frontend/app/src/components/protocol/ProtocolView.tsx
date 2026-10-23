"use client";

import { useState, type ReactNode } from "react";
import { config, LENDING_ENABLED } from "@/config";
import { stellarContractUrl } from "@/lib/explorer";
import { formatUsdc, shortAddress } from "@/lib/borrow/journey";
import { analyzeCohort } from "@/lib/metrics/cohort";
import type { RetentionCohort } from "@/lib/metrics/api";
import { networkName } from "@/lib/wallet/precheck";
import { ExternalLink } from "@/components/ui";
import { useMockWorld } from "@/components/ui/hooks";
import { Enter } from "@/components/ui/entrance";
import { Hero } from "@/components/funds/parts";
import { mockProtocolData, type ProtocolData } from "./model";

const STELLAR = networkName(config.networkPassphrase);
const contractUrl = stellarContractUrl;

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function Unavailable() {
  return <p className="wz-hint">Unavailable right now. Refresh in a minute.</p>;
}

function Block({ title, at, step, className, children }: { title: string; at: number; step: 2 | 3; className?: string; children: ReactNode }) {
  const id = `pr-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <Enter as="section" name={id} step={step} className={className ? `pr-block ${className}` : "pr-block"} aria-labelledby={id}>
      <div className="pr-block-head">
        <h2 id={id} className="pr-h2">
          {title}
        </h2>
        <span className="pr-at">Updated {clock(at)}</span>
      </div>
      {children}
    </Enter>
  );
}

function Figure({ label, value, unit, text }: { label: string; value: string; unit?: string; text?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="fu-tile-v">
        <span className={text ? "pr-text" : "mono"}>{value}</span>
        {unit ? <span className="fu-unit"> {unit}</span> : null}
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
  ...(LENDING_ENABLED
    ? [
        { label: "Commitment tree", id: config.contracts.commitmentTree },
        { label: "Writz lend", id: config.contracts.writzLend },
        { label: "Bitcoin SPV", id: config.contracts.bitcoinSpv },
        { label: "ZK verifier", id: config.contracts.zkVerifier },
        { label: "USDC token", id: config.contracts.usdcToken },
      ]
    : []),
  { label: "Earn vault (DeFindex)", id: config.earn.vaultId },
].filter((c) => c.id);

export function ProtocolView({ data: server }: { data: ProtocolData }) {
  const world = useMockWorld();
  const [now] = useState(() => Date.now());
  const d = world ? mockProtocolData(world, now) : server;
  // No borrow pool on an Earn-only deploy: its block is left out, not shown as failed.
  const pool = LENDING_ENABLED ? d.pool : null;
  const allFailed = (pool === null || pool.kind === "failed") && d.vault.kind === "failed";

  return (
    <div className="fu-page">
      <Enter as="header" name="head">
        <h1 className="fu-h1">Protocol</h1>
        <p className="fu-lede">Live reads from {STELLAR}.</p>
      </Enter>

      {allFailed ? (
        <div className="fu-stale">
          <p className="wz-note" data-tone="warning">
            <span className="wz-note-label">Unavailable</span>
            <span>Can&apos;t read {STELLAR} right now. Refresh in a minute.</span>
          </p>
        </div>
      ) : null}

      <div className="pr-grid">
        {pool ? (
        <Block title="Borrow pool" at={d.at} step={2}>
          {pool.kind === "ok" ? (
            <>
              <Hero label="Available to borrow" value={{ kind: "ok", value: pool.value.available }} unit="USDC" />
              <dl className="fu-tiles">
                <Figure label="Supplied by lenders" value={formatUsdc(pool.value.totalSupplied)} unit="USDC" />
                <Figure label="Borrowed across all open loans" value={formatUsdc(pool.value.totalBorrowed)} unit="USDC" />
              </dl>
            </>
          ) : (
            <Unavailable />
          )}
        </Block>
        ) : null}

        <Block title="Earn vault" at={d.at} step={2}>
          {d.vault.kind === "ok" ? (
            <>
              <dl className="fu-tiles pr-vault">
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
      </div>

      <Block title="30-day retention" at={d.at} step={3} className="pr-wide">
        <p className="pr-note">Of the depositors who reached 30 days, how many still hold a balance in the vault.</p>
        {d.cohorts.kind === "ok" ? <Retention cohorts={d.cohorts.value} now={d.at} /> : <Unavailable />}
      </Block>

      <Enter as="section" name="contracts" step={4} className="pr-block pr-wide" aria-labelledby="pr-contracts">
        <div className="pr-block-head">
          <h2 id="pr-contracts" className="pr-h2">
            Contracts on {STELLAR}
          </h2>
        </div>
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
      </Enter>
    </div>
  );
}
