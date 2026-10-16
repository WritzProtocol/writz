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
import { ConfirmationSlots, ExternalLink, Notice } from "@/components/ui";
import { HealthMeter, HealthText, StatusBadge } from "@/components/loan/parts";
import { useEntrance, type EntranceProps } from "@/components/ui/entrance";
import { SkBtn, T } from "@/components/ui/skeleton";
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

function secondaryAction(l: HomeLoan): { label: string; href: string } | null {
  const s = l.derived.status;
  const n = l.position.index;
  if (s.kind === "active" && s.band === "healthy") return { label: "Repay", href: loanHref(n, "repay") };
  if (s.kind === "repaid_locked" && s.neverBorrowed && !s.missingBtcDetails) return { label: "Release BTC", href: loanHref(n, "release") };
  return null;
}

export function LoanSummaryCard({
  loan,
  price,
  findLoans,
  compact = false,
  primary = true,
  enter = false,
}: {
  loan: HomeLoan;
  price: Read<bigint>;
  findLoans: () => void;
  compact?: boolean;
  primary?: boolean;
  enter?: boolean;
}) {
  const p = loan.position;
  const s = loan.derived.status;
  const collateral = BigInt(p.collateralSats);
  const debt = BigInt(p.debtStroops);
  const health = healthOf(s);
  const liq = liquidationPriceFor(collateral, debt);
  const action = cardAction(loan, findLoans);
  const secondary = secondaryAction(loan);
  const showsRisk = health !== null || s.kind === "checking";
  const closed = s.kind === "released" || s.kind === "liquidated" || s.kind === "closed_on_chain";
  const actionClass = `wz-btn ${primary ? "wz-btn-gold" : "wz-btn-line"}${compact ? " wz-btn-sm" : ""}`;
  const open = useEntrance(`loan-${p.id}`, "open", { ready: enter });

  return (
    <article {...open("hm-loan wz-cut")} data-compact={compact} aria-labelledby={`loan-${p.index}`}>
      <div className="hm-loan-main">
        <header className="hm-loan-head">
          <h2 id={`loan-${p.index}`}>{loanName(loan)}</h2>
          <StatusBadge status={s} />
        </header>
        {s.kind === "liquidated" ? <p className="hm-loan-note">{loanName(loan)} was liquidated. A liquidator repaid the debt and the loan is closed.</p> : null}
        {showsRisk && (debt > 0n || s.kind === "checking") ? (
          <div className="hm-risk">
            <HealthText ratioBp={ratioOf(s)} health={health} />
            <HealthMeter ratioBp={ratioOf(s)} health={health} />
            {liq !== null && health !== null ? (
              <p className="hm-liq">
                Liquidated if BTC falls below <b className="mono">{formatUsd(liq)}</b>.{" "}
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
      </div>
      <div className="hm-loan-side">
        <dl className="hm-kv">
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
        <div className="hm-loan-acts">
          {action ? (
            action.href ? (
              <Link href={action.href} className={actionClass}>
                {action.label}
              </Link>
            ) : (
              <button type="button" className={actionClass} onClick={action.onClick}>
                {action.label}
              </button>
            )
          ) : null}
          {secondary ? (
            <Link href={secondary.href} className={`wz-btn wz-btn-line${compact ? " wz-btn-sm" : ""}`}>
              {secondary.label}
            </Link>
          ) : null}
          <Link href={loanHref(p.index)} className="wz-btn wz-btn-text hm-stretch">
            Open {loanName(loan)}
          </Link>
        </div>
      </div>
    </article>
  );
}

/** The loan panel at its loaded size while the loan is being read. */
export function LoanSkeleton() {
  return (
    <div className="hm-loan wz-cut" data-compact="false" aria-hidden="true">
      <div className="hm-loan-main">
        <div className="hm-loan-head">
          <h2>
            <T>Loan 1</T>
          </h2>
          <SkBtn className="wz-badge">Healthy</SkBtn>
        </div>
        <div className="hm-risk">
          <p className="ln-ratio">
            <b className="mono">
              <T>200%</T>
            </b>
            <span>
              <T>Healthy</T>
            </span>
          </p>
          <HealthMeter ratioBp={null} health={null} />
          <p className="hm-liq">
            <T>Liquidated if BTC falls below $36,000. BTC now $60,000, oracle price.</T>
          </p>
        </div>
      </div>
      <div className="hm-loan-side">
        <dl className="hm-kv">
          <div>
            <dt>
              <T>Collateral</T>
            </dt>
            <dd className="mono">
              <T>0.05000000 BTC</T>
            </dd>
          </div>
          <div>
            <dt>
              <T>You owe</T>
            </dt>
            <dd className="mono">
              <T>1,500.00 USDC</T>
            </dd>
          </div>
        </dl>
        <div className="hm-loan-acts">
          <SkBtn>Borrow more</SkBtn>
          <SkBtn>Repay</SkBtn>
          <span className="wz-btn wz-btn-text">
            <T>Open Loan 1</T>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Urgent ───────────────────────────────────────────────────────────────

function DepositCard({ u, m, onCheckAgain }: { u: Extract<Urgent, { kind: "deposit" }>; m: number; onCheckAgain: () => void }) {
  const s = u.status;
  const open = useEntrance("urgent", "open", { ready: s.kind !== "register_failed" && s.kind !== "btc_unseen" });
  const txid = u.deposit?.pd.btcTxid ?? u.loan?.position.txid;
  const stellarHash = u.deposit?.pd.stellarTxHash ?? u.loan?.position.stellarTxHash;
  const mempool = txid ? (
    <ExternalLink href={btcTxUrl(txid)} className="wz-btn wz-btn-text">
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
              <ExternalLink href={stellarTxUrl(stellarHash)} className="wz-btn wz-btn-text">
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
      <section {...open("hm-card hm-urgent wz-cut-sm")} aria-labelledby="urgent-title">
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
    <section {...open("hm-card hm-urgent wz-cut-sm")} aria-labelledby="urgent-title">
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
  const open = useEntrance("preview", "open");
  const need = useEntrance("need", "in", { step: 3 });

  return (
    <div className="hm-preview">
      <section {...open("hm-card wz-cut-sm")} aria-labelledby="preview-title">
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
      <section {...need("hm-need")} aria-labelledby="need-title">
        <h2 id="need-title" className="wz-label">
          What you&apos;ll need
        </h2>
        <ul className="wz-need">
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

/** The first-visit preview at its loaded size. */
export function PreviewSkeleton() {
  return (
    <div className="hm-preview">
      <div className="hm-card wz-cut-sm">
        <p className="wz-label">
          <T>Try an amount</T>
        </p>
        <p className="wz-hint" data-sk="wallet">
          <T>You have 0.12000000 BTC.</T>
        </p>
        <div className="wz-field wz-sk-field" />
        <p className="hm-preview-line">
          <T>Lock 0.05000000 BTC. Borrow up to 2,000.00 USDC.</T>
        </p>
        <p className="wz-hint">
          <T>If Writz stops, you can reclaim your BTC alone after about 18 Jul 2027.</T>
        </p>
        <p className="wz-hint">
          <T>Writz co-signs the release when you repay.</T>
        </p>
        <div className="wz-actions">
          <SkBtn>Start</SkBtn>
          <SkBtn>Get test BTC</SkBtn>
        </div>
      </div>
      <div className="hm-need">
        <p className="wz-label">
          <T>What you&apos;ll need</T>
        </p>
        <ul className="wz-need wz-sk-list">
          <li>
            <T>A Stellar wallet such as Freighter. It receives the USDC you borrow.</T>
          </li>
          <li>
            <T>Xverse for Bitcoin. It holds the BTC you lock.</T>
          </li>
          <li>
            <T>Stellar testnet and Bitcoin signet. Test funds only.</T>
          </li>
        </ul>
        <span className="wz-btn wz-btn-text">
          <T>Earn on USDC instead</T>
        </span>
      </div>
    </div>
  );
}

export function HowSkeleton() {
  return (
    <div className="hm-how">
      <p className="hm-h2">
        <T>How a loan works</T>
      </p>
      <ol className="hm-steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="hm-step-n hm-how-n">
              <T>{i + 1}</T>
            </span>
            <div>
              <p className="hm-h3">
                <T>{s.title}</T>
              </p>
              <p>
                <T>{s.body}</T>
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="hm-wayout">
        <T>Your way out: if Writz stops, you reclaim your BTC alone after the timelock. How to reclaim</T>
      </p>
    </div>
  );
}

export function HowALoanWorks({ enter }: { enter: (className?: string) => EntranceProps }) {
  return (
    <section {...enter("hm-how")} aria-labelledby="how-title">
      <h2 id="how-title" className="hm-h2">
        How a loan works
      </h2>
      <ol className="hm-steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="hm-step-n hm-how-n" aria-hidden="true">
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
        <Link href="/help/reclaim" className="wz-btn wz-btn-text">
          How to reclaim
        </Link>
      </p>
    </section>
  );
}

// ── Earn and Lend ────────────────────────────────────────────────────────

export function EarnCard({ earn }: { earn: EarnSummary }) {
  const open = useEntrance("earn", "open");
  return (
    <section {...open("hm-card wz-cut-sm")} aria-labelledby="earn-title">
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
  const open = useEntrance("lend", "open");
  return (
    <section {...open("hm-card wz-cut-sm")} aria-labelledby="lend-title">
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
