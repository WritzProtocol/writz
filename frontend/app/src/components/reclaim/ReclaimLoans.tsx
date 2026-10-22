"use client";

import { useState, useSyncExternalStore } from "react";
import { config } from "@/config";
import { deriveP2WSH } from "@/lib/bitcoin/address";
import { fetchTipHeight } from "@/lib/bitcoin/timelock";
import { formatBtc, shortAddress } from "@/lib/borrow/journey";
import { btcTxUrl } from "@/lib/explorer";
import { blockDate } from "@/lib/loan/model";
import { reclaimWindow } from "@/lib/reclaim/model";
import type { Position } from "@/lib/position/types";
import type { MockWorld } from "@/lib/mock/types";
import { ExternalLink, Notice } from "@/components/ui";
import { useMockWorld, useMounted, useRead } from "@/components/ui/hooks";
import { useShellAccount } from "@/components/shell/account";
import { T } from "@/components/ui/skeleton";

interface LoanLock {
  n: number;
  height: number | null;
  lockAddress: string | null;
  txid: string | null;
  vout: number | null;
  sats: bigint | null;
}

const noop = () => () => {};

function loanFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get("loan");
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function lockOf(p: Position): LoanLock {
  let lockAddress: string | null = null;
  if (p.btcPubkey && p.timelockHeight && config.bitcoin.protocolPubkey) {
    try {
      lockAddress = deriveP2WSH(config.bitcoin.protocolPubkey, p.btcPubkey, p.timelockHeight).address;
    } catch {
      lockAddress = null;
    }
  }
  return {
    n: p.index + 1,
    height: p.timelockHeight ?? null,
    lockAddress,
    txid: p.txid ?? null,
    vout: p.vout ?? null,
    sats: BigInt(p.collateralSats),
  };
}

function mockLocks(world: MockWorld): LoanLock[] {
  const r = world.reclaim;
  if (!r) return [];
  return [
    {
      n: r.loan?.n ?? 1,
      height: r.timelockHeight,
      lockAddress: r.loan?.p2wsh ?? null,
      txid: r.loan?.txid ?? null,
      vout: r.loan ? 0 : null,
      sats: r.loan ? 5_000_000n : null,
    },
  ];
}

function When({ lock, tip, now }: { lock: LoanLock; tip: number | null; now: number }) {
  if (lock.height === null) return <p>This device doesn&apos;t have this loan&apos;s timelock block. Your loan backup has it.</p>;
  const w = reclaimWindow(lock.height, tip);
  const block = <span className="mono">{lock.height.toLocaleString("en-US")}</span>;
  if (w.kind === "reached") {
    return (
      <p>
        <b>Reclaim is available now.</b> Bitcoin passed block {block}.
      </p>
    );
  }
  if (w.kind === "unknown") return <p>Block {block}. Checking the current height...</p>;
  return (
    <p>
      After Bitcoin block {block}, about {blockDate(w.blocksLeft, now)}. That is {w.blocksLeft.toLocaleString("en-US")} blocks
      from now.
    </p>
  );
}

function LoanCard({ lock, tip, now, detailed }: { lock: LoanLock; tip: number | null; now: number; detailed: boolean }) {
  return (
    <section className="rc-loan" aria-labelledby={`rc-loan-${lock.n}`}>
      <h3 id={`rc-loan-${lock.n}`} className="rc-h3">
        Loan {lock.n}
      </h3>
      <When lock={lock} tip={tip} now={now} />
      {detailed ? (
        <dl className="rc-facts">
          {lock.lockAddress ? (
            <div>
              <dt>Lock address</dt>
              <dd className="mono" aria-label={lock.lockAddress}>
                {shortAddress(lock.lockAddress, 10, 8)}
              </dd>
            </div>
          ) : null}
          {lock.txid ? (
            <div>
              <dt>Deposit transaction</dt>
              <dd>
                <ExternalLink href={btcTxUrl(lock.txid)} className="wz-link mono">
                  {shortAddress(lock.txid, 8, 8)}
                </ExternalLink>
                {lock.vout !== null ? <span className="wz-muted">, output {lock.vout}</span> : null}
              </dd>
            </div>
          ) : null}
          {lock.sats !== null ? (
            <div>
              <dt>Amount locked</dt>
              <dd className="mono">{formatBtc(lock.sats)} BTC</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

function LoansSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="rc-loans" data-sk="loans">
        <div className="rc-loan">
          <p className="rc-h3">
            <T>Loan 1</T>
          </p>
          <p>
            <T>After Bitcoin block 300,000, about 21 Jul 2027. That is 40,000 blocks from now.</T>
          </p>
        </div>
      </div>
      <div className="wz-note" data-tone="neutral" data-sk="noloans">
        <div>
          <p>
            <T>Connect the Stellar wallet you used and find your loans to see each one&apos;s timelock block here.</T>
          </p>
        </div>
      </div>
    </div>
  );
}

export function ReclaimLoans() {
  const mounted = useMounted();
  const world = useMockWorld();
  const a = useShellAccount();
  const fromUrl = useSyncExternalStore(noop, loanFromUrl, () => null);
  const requested = world ? (world.reclaim?.loan?.n ?? null) : fromUrl;
  const [now] = useState(() => Date.now());
  const tipRead = useRead(world ? null : "tip", () => fetchTipHeight(config.bitcoin.apiUrl));
  const tip = world ? (world.chain.btcTipHeight ?? null) : tipRead.kind === "ok" ? tipRead.value : null;

  if (!mounted || !a.walletsKnown) return <LoansSkeleton />;
  const all = world ? mockLocks(world) : a.positions.filter((p) => p.status !== "pending").map(lockOf);
  const shown = requested !== null ? all.filter((l) => l.n === requested) : all;

  if (shown.length === 0) {
    return (
      <Notice tone="neutral" label="Your loans">
        <p>
          {requested !== null
            ? `Loan ${requested} isn't on this device. Connect the Stellar wallet you used and find your loans, or use your loan backup.`
            : "Connect the Stellar wallet you used and find your loans to see each one's timelock block here."}
        </p>
      </Notice>
    );
  }
  return (
    <div className="rc-loans">
      {shown.map((l) => (
        <LoanCard key={l.n} lock={l} tip={tip} now={now} detailed={requested !== null || shown.length === 1} />
      ))}
    </div>
  );
}
