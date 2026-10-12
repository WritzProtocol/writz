"use client";

import Link from "next/link";
import { useState } from "react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { chooseDepositTimelock } from "@/lib/bitcoin/timelock";
import { formatBtc, formatUsd, formatUsdc, maxBorrowStroops, parseBtcAmount, timeLeft } from "@/lib/borrow/journey";
import { btcTxUrl, stellarTxUrl } from "@/lib/explorer";
import type { HomeLoan, Urgent } from "@/lib/home/model";
import { BTC_FAUCETS } from "@/lib/links";
import { setDraftAmount } from "@/lib/borrow/draft";
import { blockDate, healthOf, liquidationPriceFor, loanHref, repayToSafeStroops, type Read } from "@/lib/loan/model";
import { networkName } from "@/lib/wallet/precheck";
import type { PositionStatus } from "@/lib/status/types";
import { ConfirmationSlots, ExternalLink, Notice } from "@/components/redesign/ui";
import { HealthMeter, HealthText, StatusBadge } from "@/components/loan/parts";
import type { EarnSummary } from "./data";

const STELLAR = networkName(config.networkPassphrase);
const DEFAULT_PREVIEW = "0.05";

const loanName = (l: HomeLoan) => `Loan ${l.position.index + 1}`;

// ── Loans ────────────────────────────────────────────────────────────────

function ratioOf(s: PositionStatus): bigint | null {
  return s.kind === "active" || s.kind === "at_risk" || s.kind === "liquidatable" ? s.ratioBp : null;
}

function cardAction(l: HomeLoan, findLoans: () => void): { label: string; href?: string; onClick?: () => void } | null {
  const s = l.derived.status;
  const n = l.position.index;
  switch (s.kind) {
    case "active":
      return s.band === "healthy" ? { label: "Borrow more", href: loanHref(n, "borrow") } : { label: "Repay", href: loanHref(n, "repay") };
    case "at_risk":
    case "liquidatable":
      return { label: "Repay", href: loanHref(n, "repay") };
    case "repaid_locked":
      return s.neverBorrowed ? { label: "Borrow", href: loanHref(n, "borrow") } : { label: "Release BTC", href: loanHref(n, "release") };
    case "register_failed":
      return { label: "Finish deposit", href: "/borrow/new" };
    case "changed_elsewhere":
      return { label: "Find my loans", onClick: findLoans };
    default:
      return null;
  }
}

export function LoanSummaryCard({ loan, price, findLoans }: { loan: HomeLoan; price: Read<bigint>; findLoans: () => void }) {
  const p = loan.position;
  const s = loan.derived.status;
  const collateral = BigInt(p.collateralSats);
  const debt = BigInt(p.debtStroops);
  const health = healthOf(s);
  const liq = liquidationPriceFor(collateral, debt);
  const action = cardAction(loan, findLoans);
  const showsRisk = health !== null || s.kind === "checking";
  const closed = s.kind === "released" || s.kind === "liquidated" || s.kind === "closed_on_chain";

  return (
    <article className="hm-card hm-loan" aria-labelledby={`loan-${p.index}`}>
      <header className="hm-loan-head">
        <h3 id={`loan-${p.index}`} className="hm-h3">
          <Link href={loanHref(p.index)} className="hm-stretch">
            {loanName(loan)}
          </Link>
        </h3>
        <StatusBadge status={s} />
      </header>
      {s.kind === "liquidated" ? <p className="wz-hint">{loanName(loan)} was liquidated. A liquidator repaid the debt and the loan is closed.</p> : null}
      <dl className="hm-facts">
        <div>
          <dt>Collateral</dt>
          <dd className="mono">{formatBtc(collateral)} BTC</dd>
        </div>
        {!closed ? (
          <div>
            <dt>You owe</dt>
            <dd className="mono">{formatUsdc(debt)} USDC</dd>
          </div>
        ) : null}
      </dl>
      {showsRisk && debt > 0n ? (
        <div className="hm-risk">
          <HealthText ratioBp={ratioOf(s)} health={health} />
          <HealthMeter ratioBp={ratioOf(s)} health={health} />
          {liq !== null ? (
            <p className="wz-hint">
              Liquidated if BTC falls below <b className="mono wz-strong">{formatUsd(liq)}</b>.{" "}
              {price.kind === "ok" ? (
                <>
                  BTC now <span className="mono">{formatUsd(price.value)}</span>, oracle price.
                </>
              ) : price.kind === "failed" ? (
                "BTC price unavailable."
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}
      {action ? (
        <div className="hm-card-actions">
          {action.href ? (
            <Link href={action.href} className="wz-btn wz-btn-line wz-btn-sm">
              {action.label}
            </Link>
          ) : (
            <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function LoanSkeleton() {
  return (
    <div className="hm-card hm-loan" aria-hidden="true">
      <div className="wz-skeleton" style={{ height: 28, width: 120 }} />
      <div className="wz-skeleton" style={{ height: 56 }} />
      <div className="wz-skeleton" style={{ height: 40 }} />
    </div>
  );
}

// ── Urgent ───────────────────────────────────────────────────────────────

function DepositCard({ u, m, onCheckAgain }: { u: Extract<Urgent, { kind: "deposit" }>; m: number; onCheckAgain: () => void }) {
  const s = u.status;
  const txid = u.deposit?.pd.btcTxid ?? u.loan?.position.txid;
  const stellarHash = u.deposit?.pd.stellarTxHash ?? u.loan?.position.stellarTxHash;
  const mempool = txid ? (
    <ExternalLink href={btcTxUrl(txid)} className="wz-link">
      View on mempool
    </ExternalLink>
  ) : null;

  if (s.kind === "register_failed") {
    return (
      <Notice
        tone="warning"
        label="Finish deposit"
        actions={
          <>
            <Link href="/borrow/new" className="wz-btn wz-btn-gold">
              Finish deposit
            </Link>
            {stellarHash ? (
              <ExternalLink href={stellarTxUrl(stellarHash)} className="wz-link">
                Stellar transaction
              </ExternalLink>
            ) : null}
          </>
        }
      >
        <p>
          <b>Your BTC is safe in the lock.</b> One step is left to finish your deposit.
        </p>
      </Notice>
    );
  }
  if (s.kind === "btc_unseen") {
    return (
      <Notice
        tone="warning"
        label="Not seen on Bitcoin yet"
        actions={
          <>
            <button type="button" className="wz-btn wz-btn-gold" onClick={onCheckAgain}>
              Check again
            </button>
            {mempool}
          </>
        }
      >
        <p>Bitcoin hasn&apos;t seen this transaction yet.</p>
      </Notice>
    );
  }

  if (s.kind === "checking") {
    return (
      <section className="hm-card hm-urgent" aria-labelledby="urgent-title">
        <span className="wz-label">Deposit in progress</span>
        <h2 id="urgent-title" className="hm-h2">
          Checking your deposit...
        </h2>
        <div className="wz-actions">
          <Link href="/borrow/new" className="wz-btn wz-btn-line">
            View progress
          </Link>
          {mempool}
        </div>
      </section>
    );
  }

  const n = s.kind === "confirming" ? s.n : s.kind === "btc_sent" ? 0 : m;
  const total = s.kind === "confirming" ? s.m : m;
  const ready = s.kind === "ready_to_register";
  const registering = s.kind === "proving" || s.kind === "registering";
  return (
    <section className="hm-card hm-urgent" aria-labelledby="urgent-title">
      <span className="wz-label">Deposit in progress</span>
      <h2 id="urgent-title" className="hm-h2">
        {registering
          ? "Registering your deposit on Stellar."
          : ready
            ? `${total} of ${total} confirmations. One signature left.`
            : `${n} of ${total} confirmations. You can leave.`}
      </h2>
      {!registering ? <ConfirmationSlots n={n} m={total} /> : null}
      {!ready && !registering ? <p className="wz-hint">{timeLeft(total - n)}. Your progress is saved in this browser.</p> : null}
      <div className="wz-actions">
        <Link href="/borrow/new" className={`wz-btn ${ready ? "wz-btn-gold" : "wz-btn-line"}`}>
          {ready ? "Finish in one signature" : "View progress"}
        </Link>
        {mempool}
      </div>
    </section>
  );
}

export function UrgentCard({
  u,
  price,
  m,
  onCheckAgain,
  findLoans,
}: {
  u: Urgent;
  price: Read<bigint>;
  m: number;
  onCheckAgain: () => void;
  findLoans: () => void;
}) {
  switch (u.kind) {
    case "deposit":
      return <DepositCard u={u} m={m} onCheckAgain={onCheckAgain} />;
    case "at_risk":
    case "liquidatable": {
      const p = u.loan.position;
      const toSafe = price.kind === "ok" ? repayToSafeStroops(BigInt(p.collateralSats), BigInt(p.debtStroops), price.value) : null;
      const label = u.kind === "liquidatable" ? "Can be liquidated now" : "Close to liquidation";
      return (
        <Notice
          tone={u.kind === "liquidatable" ? "danger" : "warning"}
          label={label}
          actions={
            <>
              <Link href={loanHref(p.index, "repay")} className="wz-btn wz-btn-gold">
                {toSafe ? `Repay ${formatUsdc(toSafe)} USDC` : "Repay"}
              </Link>
              <Link href={loanHref(p.index)} className="wz-btn wz-btn-line">
                Open loan
              </Link>
            </>
          }
        >
          <p>
            <b>{loanName(u.loan)}.</b> {toSafe ? `Repay ${formatUsdc(toSafe)} USDC to reach 150%.` : "Repay some USDC to raise the ratio."}
          </p>
        </Notice>
      );
    }
    case "repaid":
      return (
        <Notice
          tone="info"
          label="Loan repaid"
          actions={
            <Link href={loanHref(u.loan.position.index, "release")} className="wz-btn wz-btn-gold">
              Release BTC
            </Link>
          }
        >
          <p>
            <b>{loanName(u.loan)} is repaid.</b> Your BTC is still locked. Release it to your wallet.
          </p>
        </Notice>
      );
    case "changed":
      return (
        <Notice
          tone="info"
          label="Changed on another device"
          actions={
            <button type="button" className="wz-btn wz-btn-gold" onClick={findLoans}>
              Find my loans
            </button>
          }
        >
          <p>{loanName(u.loan)} changed on another device.</p>
        </Notice>
      );
    case "reclaimable":
      return (
        <Notice
          tone="info"
          label="Reclaim available"
          actions={
            <Link href={`/help/reclaim?loan=${u.loan.position.index + 1}`} className="wz-btn wz-btn-line">
              How to reclaim
            </Link>
          }
        >
          <p>{loanName(u.loan)} can be reclaimed without Writz.</p>
        </Notice>
      );
  }
}

// ── New users ────────────────────────────────────────────────────────────

export function Preview({
  price,
  balance,
  tipHeight,
  now,
}: {
  price: Read<bigint>;
  balance: Read<bigint> | null;
  tipHeight: number | null;
  now: number;
}) {
  const own = balance?.kind === "ok" ? balance.value : null;
  const [amount, setAmount] = useState(() => (own && own > 0n ? formatBtc(own) : DEFAULT_PREVIEW));
  const parsed = parseBtcAmount(amount);
  const sats = parsed.ok ? parsed.sats : null;
  const max = sats !== null && price.kind === "ok" ? maxBorrowStroops(sats, price.value) : null;
  const exit = tipHeight !== null ? blockDate(chooseDepositTimelock(tipHeight) - tipHeight, now) : null;
  const empty = own === 0n;
  const handOff = () => {
    if (sats !== null) setDraftAmount(amount.trim());
  };

  return (
    <div className="hm-preview">
      <section className="hm-card" aria-labelledby="preview-title">
        <h2 id="preview-title" className="wz-label">
          Try an amount
        </h2>
        {own !== null && own > 0n ? (
          <p className="wz-hint">
            You have <span className="mono">{formatBtc(own)}</span> BTC.
          </p>
        ) : null}
        <label className="wz-sr" htmlFor="preview-amount">
          BTC to lock
        </label>
        <div className="wz-field" data-invalid={!parsed.ok && amount !== ""}>
          <input
            id="preview-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-describedby="preview-result"
            aria-invalid={!parsed.ok}
          />
          <span>BTC</span>
        </div>
        <p id="preview-result" className="hm-preview-line" aria-live="polite">
          {!parsed.ok ? (
            <span className="wz-error">{parsed.error}</span>
          ) : max !== null ? (
            <>
              Lock <b className="mono">{formatBtc(sats!)}</b> BTC. Borrow up to <b className="mono">{formatUsdc(max)}</b> USDC.
            </>
          ) : price.kind === "failed" ? (
            "BTC price unavailable right now."
          ) : (
            "Checking the BTC price..."
          )}
        </p>
        {exit ? <p className="wz-hint">If Writz stops, you can reclaim your BTC alone after about {exit}.</p> : null}
        <p className="wz-hint">Writz co-signs the release when you repay.</p>
        {empty ? (
          <p className="wz-hint">Your Bitcoin wallet is empty. Get test BTC first.</p>
        ) : null}
        <div className="wz-actions">
          {empty ? (
            <ExternalLink href={BTC_FAUCETS[0].href} className="wz-btn wz-btn-gold">
              Get test BTC
            </ExternalLink>
          ) : (
            <Link href="/borrow/new" className="wz-btn wz-btn-gold" onClick={handOff}>
              Start
            </Link>
          )}
          {empty ? (
            <Link href="/borrow/new" className="wz-btn wz-btn-line" onClick={handOff}>
              Start
            </Link>
          ) : (
            <ExternalLink href={BTC_FAUCETS[0].href} className="wz-btn wz-btn-line">
              Get test BTC
            </ExternalLink>
          )}
        </div>
      </section>
      <section className="hm-need" aria-labelledby="need-title">
        <h2 id="need-title" className="wz-label">
          What you&apos;ll need
        </h2>
        <ul className="fo-need">
          <li>
            <b>A Stellar wallet</b> such as Freighter. It receives the USDC you borrow.
          </li>
          <li>
            <b>Xverse</b> for Bitcoin. It holds the BTC you lock.
          </li>
          <li>
            {STELLAR} and {BTC_NETWORK_LABEL}. Test funds only.
          </li>
        </ul>
        <Link href="/earn" className="wz-btn wz-btn-text">
          Earn on USDC instead
        </Link>
      </section>
    </div>
  );
}

const STEPS = [
  {
    title: "Lock BTC on Bitcoin",
    body: "Your BTC goes into a Bitcoin Script address that only your key and Writz's can release together. It never leaves the Bitcoin chain.",
  },
  {
    title: "Borrow dollars",
    body: "Take up to two thirds of your BTC's value in USDC, straight to your Stellar wallet. Borrowing less leaves more room before liquidation.",
  },
  {
    title: "Repay and unlock",
    body: "Pay back the loan whenever you like. Writz co-signs the release and your BTC returns to your wallet.",
  },
];

export function HowALoanWorks() {
  return (
    <section className="hm-how" aria-labelledby="how-title">
      <h2 id="how-title" className="hm-h2">
        How a loan works
      </h2>
      <ol className="hm-steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="hm-step-n" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <h3 className="hm-h3">{s.title}</h3>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="hm-wayout">
        <b>Your way out:</b> if Writz stops, you reclaim your BTC alone after the timelock.{" "}
        <Link href="/help/reclaim" className="wz-link">
          How to reclaim
        </Link>
      </p>
    </section>
  );
}

// ── Earn and Lend ────────────────────────────────────────────────────────

export function EarnCard({ earn }: { earn: EarnSummary }) {
  return (
    <section className="hm-card" aria-labelledby="earn-title">
      <h2 id="earn-title" className="wz-label">
        Earn
      </h2>
      <p className="hm-big mono">
        {formatUsdc(earn.balanceStroops)} <span>USDC</span>
      </p>
      {earn.earnedStroops !== null ? <p className="wz-hint">Earned so far: {formatUsdc(earn.earnedStroops)} USDC (Blend).</p> : null}
      {earn.apy !== null ? (
        <p className="wz-hint">
          {(earn.apy * 100).toFixed(2)}% APY from Blend lending, via DeFindex.
        </p>
      ) : null}
      <div className="wz-actions">
        <Link href="/earn" className="wz-btn wz-btn-line wz-btn-sm">
          Go to Earn
        </Link>
      </div>
    </section>
  );
}

export function LendCard({ supplied }: { supplied: bigint }) {
  return (
    <section className="hm-card" aria-labelledby="lend-title">
      <h2 id="lend-title" className="wz-label">
        Lend
      </h2>
      <p className="hm-big mono">
        {formatUsdc(supplied)} <span>USDC</span>
      </p>
      <p className="wz-hint">You supplied {formatUsdc(supplied)} USDC to the borrow pool.</p>
      <div className="wz-actions">
        <Link href="/lend" className="wz-btn wz-btn-line wz-btn-sm">
          Go to Lend
        </Link>
      </div>
    </section>
  );
}
