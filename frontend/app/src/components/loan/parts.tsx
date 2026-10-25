"use client";

import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { btcTxUrl, stellarTxUrl } from "@/lib/explorer";
import { hashOf, isInFlight, type FlowState } from "@/lib/flow/engine";
import { formatBtc, formatUsd, formatUsdc, shortAddress } from "@/lib/borrow/journey";
import { releaseAddressOf, releaseBlocker } from "@/lib/flows/release";
import { AT_RISK_BP, BORROW_LIMIT_BP, LIQUIDATION_BP } from "@/lib/status/derive";
import { LIQUIDATION_DOCS_URL } from "@/lib/links";
import {
  RELEASE_STEPS,
  afterState,
  liquidationPriceFor,
  parseUsdcAmount,
  readValue,
  releaseStepOf,
  toFieldValue,
  type ActivityItem,
  type Available,
  type Health,
} from "@/lib/loan/model";
import type { Position } from "@/lib/position/types";
import type { PositionStatus } from "@/lib/status/types";
import type { ErrorFlow } from "@/lib/errors";
import { networkName } from "@/lib/wallet/precheck";
import { useElapsed } from "@/components/ui/hooks";
import { Enter } from "@/components/ui/entrance";
import { ErrorBox, ExternalLink, Notice, SlideToConfirm, Spinner, type Tone } from "@/components/ui";
import type { LoanModel } from "./model";
import type { ReceiveIntent } from "@/lib/receive/intent";
import { ReceiveStep } from "./ReceiveStep";

const RECEIVE_USDC: ReceiveIntent = { kind: "usdc" };

const STELLAR = networkName(config.networkPassphrase);

export const HEALTH_LABEL: Record<Health, string> = {
  none: "No debt",
  healthy: "Healthy",
  below_limit: "Below borrow limit",
  at_risk: "Close to liquidation",
  liquidatable: "Can be liquidated now",
};

const HEALTH_TONE: Record<Health, Tone> = {
  none: "neutral",
  healthy: "positive",
  below_limit: "info",
  at_risk: "warning",
  liquidatable: "danger",
};

export const pct = (bp: bigint) => `${Math.floor(Number(bp) / 100)}%`;

// ── Header ───────────────────────────────────────────────────────────────

export function badgeOf(status: PositionStatus): { label: string; tone: Tone } {
  switch (status.kind) {
    case "checking":
      return { label: "Checking...", tone: "neutral" };
    case "active":
      return { label: HEALTH_LABEL[status.band], tone: HEALTH_TONE[status.band] };
    case "at_risk":
      return { label: "Close to liquidation", tone: "warning" };
    case "liquidatable":
      return { label: "Can be liquidated now", tone: "danger" };
    case "repaid_locked":
      return status.neverBorrowed ? { label: "Open, no debt", tone: "neutral" } : { label: "BTC still locked", tone: "info" };
    case "releasing":
      return { label: "Releasing", tone: "info" };
    case "released":
      return { label: "BTC released", tone: "positive" };
    case "liquidated":
      return { label: "Liquidated", tone: "danger" };
    default:
      return { label: "Registering on Stellar", tone: "info" };
  }
}

export function StatusBadge({ status }: { status: PositionStatus }) {
  const { label, tone } = badgeOf(status);
  return (
    <span className="wz-badge" data-tone={tone}>
      <i aria-hidden="true" />
      <span className="wz-sr">Status: </span>
      {label}
    </span>
  );
}

// ── Risk ─────────────────────────────────────────────────────────────────

const MIN = 100;
const MAX = 250;
const at = (p: number) => Math.max(0, Math.min(100, ((p - MIN) / (MAX - MIN)) * 100));
const pos = (p: number) => `${at(p)}%`;
const LIQ = Number(LIQUIDATION_BP) / 100;
const RISK = Number(AT_RISK_BP) / 100;
const LIMIT = Number(BORROW_LIMIT_BP) / 100;
const LIQ_AT = pos(LIQ);
const RISK_AT = pos(RISK);
const LIMIT_AT = pos(LIMIT);
const ZONES = [
  { zone: "danger", label: "Liquidation", from: 0, to: at(LIQ) },
  { zone: "warning", label: "Close to liquidation", from: at(LIQ), to: at(RISK) },
  { zone: "info", label: "Below borrow limit", from: at(RISK), to: at(LIMIT) },
  { zone: "positive", label: "Healthy", from: at(LIMIT), to: 100 },
] as const;

// Bands sit on the same coordinates as the track's ticks, leaving the 2px
// gap centred on each boundary, so the two rows cut in the same places.
const bandStyle = (from: number, to: number) => ({
  left: from === 0 ? "0" : `calc(${from}% + 1px)`,
  right: to === 100 ? "0" : `calc(${100 - to}% + 1px)`,
});

/** A ratio that stands for "nothing owed" on the meter, past its right end. */
export const NO_DEBT_BP = BigInt(MAX * 100);

function meterText(p: number | null, health: Health | null): string {
  if (health === null) return "Collateral ratio checking.";
  if (health === "none") return "No debt, nothing can be liquidated.";
  return `Collateral ratio ${Math.floor(p!)}%, ${HEALTH_LABEL[health].toLowerCase()}. Liquidation at ${LIQ}%. Close to liquidation from ${LIQ}% to ${RISK}%. Borrowing stops below ${LIMIT}%.`;
}

/**
 * Bullet meter on a 100% to 250% scale: fill to the ratio, fine ticks at the
 * liquidation, at-risk and borrow-limit lines with the four status zones
 * under the track, the
 * gold marker at the ratio and, while an amount is typed, an outlined marker
 * at the ratio it would leave.
 */
export function HealthMeter({
  ratioBp,
  health,
  preview = null,
}: {
  ratioBp: bigint | null;
  health: Health | null;
  preview?: bigint | null;
}) {
  const p = health === null ? null : health === "none" || ratioBp === null ? MAX : Number(ratioBp) / 100;
  const text = meterText(p, health);
  const known = p !== null;
  const style = { ["--at" as string]: known ? pos(p) : "0%" };
  return (
    <div className="ln-bm" data-tone={health ? HEALTH_TONE[health] : "neutral"} data-state={known ? "known" : "checking"}>
      <div
        className="ln-bm-scale"
        style={style}
        role="meter"
        aria-label="Collateral ratio"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={known ? Math.min(MAX, Math.floor(p)) : undefined}
        aria-valuetext={text}
      >
        <div className="ln-bm-track">
          {known ? <span className="ln-bm-fill" /> : null}
          <span className="ln-bm-tk" style={{ left: LIQ_AT }} />
          <span className="ln-bm-tk" style={{ left: RISK_AT }} />
          <span className="ln-bm-tk" style={{ left: LIMIT_AT }} />
        </div>
        <div className="ln-bm-bands" aria-hidden="true">
          {ZONES.map((z) => (
            <span key={z.zone} className="ln-bm-z" data-zone={z.zone} style={bandStyle(z.from, z.to)} />
          ))}
        </div>
        {known ? <span className="ln-bm-marker" aria-hidden="true" /> : null}
        {known && preview !== null ? (
          <span className="ln-bm-pre" aria-hidden="true" style={{ left: pos(Number(preview) / 100) }}>
            <svg viewBox="0 0 16 28" aria-hidden="true">
              <polygon points="8.78,1 15,1 7.22,27 1.33,27" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" />
            </svg>
          </span>
        ) : null}
        <div className="ln-bm-ticks" aria-hidden="true">
          <span style={{ left: LIQ_AT }}>{LIQ}%</span>
          <span style={{ left: LIMIT_AT }}>{LIMIT}%</span>
        </div>
      </div>
      <ul className="ln-bm-legend" aria-hidden="true">
        {ZONES.map((z) => (
          <li key={z.zone}>
            <i data-zone={z.zone} />
            {z.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The ratio in large figures with its status in words beside it. */
export function HealthText({ ratioBp, health }: { ratioBp: bigint | null; health: Health | null }) {
  if (health === null)
    return (
      <p className="ln-ratio" data-tone="neutral">
        <b>Checking...</b>
      </p>
    );
  if (health === "none" || ratioBp === null)
    return (
      <p className="ln-ratio" data-tone="neutral">
        <b>No debt</b>
      </p>
    );
  return (
    <p className="ln-ratio" data-tone={HEALTH_TONE[health]}>
      <b className="mono">{pct(ratioBp)}</b>
      <span>
        <i aria-hidden="true" />
        {HEALTH_LABEL[health]}
      </span>
    </p>
  );
}

// ── Way out ──────────────────────────────────────────────────────────────

function BlockRef({ height }: { height: number | null }) {
  return height === null ? <>its timelock block</> : <>block <span className="mono">{height.toLocaleString("en-US")}</span></>;
}

export function WayOut({
  n,
  height,
  date,
  reclaimable,
  progress,
  opened,
}: {
  n: number;
  height: number | null;
  date: string | null;
  reclaimable: boolean;
  progress: number | null;
  opened: string;
}) {
  return (
    <Enter as="section" name="wayout" kind="open" className="ln-out wz-cut-sm" aria-labelledby="way-out">
      <h2 id="way-out" className="ln-h2">
        Your way out
      </h2>
      <p className="ln-out-text">
        {reclaimable ? (
          <>
            Bitcoin passed <BlockRef height={height} />, so you can reclaim this BTC with your
            Bitcoin key alone, without Writz.{" "}
          </>
        ) : (
          <>
            If Writz stops, you can reclaim this BTC with your Bitcoin key alone after <BlockRef height={height} />
            {date ? `, about ${date}` : ""}.{" "}
          </>
        )}
        <Link href={`/help/reclaim?loan=${n}`} className="wz-btn wz-btn-text wz-inline">
          How to reclaim
        </Link>
      </p>
      {progress !== null ? (
        <>
          <div className="ln-out-track" aria-hidden="true" style={{ ["--at" as string]: `${Math.max(2, Math.min(100, progress * 100))}%` }}>
            <b />
            <span />
          </div>
          <div className="ln-out-ends" aria-hidden="true">
            <span>Opened {opened}</span>
            {height !== null ? (
              <span>
                Block <span className="mono">{height.toLocaleString("en-US")}</span>
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </Enter>
  );
}

// ── Transaction status ───────────────────────────────────────────────────

function TxLinkInline({ hash, chain = "stellar" }: { hash: string; chain?: "stellar" | "bitcoin" }) {
  return (
    <ExternalLink href={chain === "stellar" ? stellarTxUrl(hash) : btcTxUrl(hash)} className="wz-link mono">
      {shortAddress(hash, 6, 4)}
    </ExternalLink>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <div className="wz-status">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

/** A Stellar transaction from this panel while it runs. Results are shown by `TxResult`. */
export function TxRunning({ flow, walletName }: { flow: FlowState; walletName: string }) {
  const slow = useElapsed(flow.phase === "awaiting_signature", 10_000);
  const hash = hashOf(flow);
  switch (flow.phase) {
    case "awaiting_signature":
      return (
        <div className="wz-stack" style={{ gap: 8 }}>
          <Status>
            Confirm in {walletName}. Fee about 0.01 XLM.
          </Status>
          {slow && <p className="wz-hint">Didn&apos;t see it? Open {walletName} from your browser toolbar.</p>}
        </div>
      );
    case "submitted":
      return (
        <Status>
          Sent. Waiting for {STELLAR}. {hash && <TxLinkInline hash={hash} />}
        </Status>
      );
    case "post_processing":
      return <Status>Confirmed on {STELLAR}. Updating Writz...</Status>;
    default:
      return <Status>Preparing...</Status>;
  }
}

/** The outcome of the panel's last Stellar transaction. */
export function TxResult({
  flow,
  success,
  walletName,
  context,
  onDismiss,
  onCheckAgain,
}: {
  flow: FlowState;
  success: ReactNode;
  walletName: string;
  context: ErrorFlow;
  onDismiss: () => void;
  onCheckAgain: () => void;
}) {
  const hash = hashOf(flow);
  switch (flow.phase) {
    case "settled":
      return (
        <Notice tone="positive" label="Done" className="wz-enter">
          <p>
            {success} {hash && <TxLinkInline hash={hash} />}
          </p>
        </Notice>
      );
    case "signature_cancelled":
      return (
        <Notice tone="neutral">
          <p>You declined in {flow.walletName ?? walletName}. Nothing was sent.</p>
        </Notice>
      );
    case "timed_out":
      return (
        <Notice
          tone="warning"
          label="Not confirmed yet"
          actions={
            <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={onCheckAgain}>
              Check again
            </button>
          }
        >
          <p>
            Your transaction was sent but isn&apos;t confirmed yet. It may still go through. Don&apos;t send it again.{" "}
            <TxLinkInline hash={flow.hash} />
          </p>
        </Notice>
      );
    case "failed":
      return (
        <ErrorBox
          error={flow.error}
          context={{ flow: context }}
          hash={hash}
          actions={
            <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={onDismiss}>
              Try again
            </button>
          }
        />
      );
    default:
      return null;
  }
}

// ── Amount field ─────────────────────────────────────────────────────────

export function AmountField({
  id,
  label,
  value,
  onChange,
  maxLabel,
  onMax,
  error,
  hint,
  disabled,
  unit = "USDC",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLabel: string;
  onMax: () => void;
  error: string | null;
  hint: ReactNode;
  disabled?: boolean;
  unit?: string;
}) {
  return (
    <div className="wz-stack" style={{ gap: 8 }}>
      <label htmlFor={id} className="wz-label">
        {label}
      </label>
      <div className="wz-field ln-field" data-invalid={Boolean(error)}>
        <input
          id={id}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          placeholder="0.00"
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>{unit}</span>
        <button type="button" className="wz-chip ln-max" onClick={onMax} disabled={disabled}>
          {maxLabel}
        </button>
      </div>
      <p id={`${id}-hint`} className={error ? "wz-error" : "wz-hint"}>
        {error ?? hint}
      </p>
    </div>
  );
}

function After({
  collateralSats,
  debt,
  price,
  overLimit = false,
  overPool = false,
}: {
  collateralSats: bigint;
  debt: bigint | null;
  price: bigint | null;
  overLimit?: boolean;
  overPool?: boolean;
}) {
  let body: ReactNode = "Enter an amount to see your new ratio.";
  if (overLimit) body = "That is more than the safe limit for this loan.";
  else if (overPool) body = "That is more than the pool has available right now.";
  else if (debt !== null && debt <= 0n) body = "After this: loan repaid. Next, release your BTC.";
  else if (debt !== null && price) {
    const a = afterState(collateralSats, debt, price);
    if (!a.repaid)
      body = (
        <>
          After this: ratio <b className="mono">{pct(a.ratioBp)}</b>, liquidated if BTC falls below{" "}
          <b className="mono">{formatUsd(a.liquidationPrice)}</b>.
        </>
      );
  } else if (debt !== null) body = null;
  return (
    <p className="ln-after" aria-live="polite">
      {body}
    </p>
  );
}

/** The ratio a typed amount would leave, for the meter's outlined marker; null when there is nothing valid to show. */
function previewOf(collateralSats: bigint, debt: bigint | null, price: bigint | null): bigint | null {
  if (debt === null || !price) return null;
  const a = afterState(collateralSats, debt, price);
  return a.repaid ? NO_DEBT_BP : a.ratioBp;
}

function usePreview(onPreview: ((bp: bigint | null) => void) | undefined, bp: bigint | null) {
  useEffect(() => {
    onPreview?.(bp);
  }, [onPreview, bp]);
  useEffect(() => () => onPreview?.(null), [onPreview]);
}

const usdcAmount = (s: bigint) => <span className="mono">{formatUsdc(s)}</span>;

// ── Borrow ───────────────────────────────────────────────────────────────

/** The BTC price at which this debt would be liquidated, from `liquidationPriceFor`. */
function LiquidationEstimate({ collateralSats, debt }: { collateralSats: bigint; debt: bigint }) {
  const liq = liquidationPriceFor(collateralSats, debt);
  return (
    <dl className="ln-est">
      <div className="wz-row">
        <dt>Liquidation price</dt>
        <dd>
          {liq !== null ? <span className="mono">{formatUsd(liq)}</span> : "No debt, nothing to liquidate"}
          <small>Estimate at the current oracle price</small>
        </dd>
      </div>
    </dl>
  );
}

export function BorrowPanel({
  m,
  position,
  available,
  price,
  onPreview,
  receiveAs = RECEIVE_USDC,
}: {
  m: LoanModel;
  position: Position;
  available: Available | null;
  price: bigint | null;
  onPreview?: (bp: bigint | null) => void;
  /** How the borrower wants the money; anything but USDC adds a second step after the borrow. */
  receiveAs?: ReceiveIntent;
}) {
  const [value, setValue] = useState("");
  const [keptHash, setKeptHash] = useState<string | null>(null);
  const id = useId();
  const mine = m.action === "borrow";
  const running = mine && isInFlight(m.flow);
  const collateral = BigInt(position.collateralSats);
  const debt = BigInt(position.debtStroops);
  const max = available?.stroops ?? 0n;
  const parsed = value.trim() ? parseUsdcAmount(value) : null;
  const amount = parsed?.ok ? parsed.stroops : null;
  const x = formatUsdc(max);
  const overMax = parsed?.ok === true && amount !== null && amount > max;
  const overLimit = overMax && !available?.limitedByPool;
  const overPool = overMax && Boolean(available?.limitedByPool);
  const error =
    parsed && !parsed.ok
      ? parsed.error
      : amount !== null && amount > max
        ? available?.limitedByPool
          ? `The pool has ${x} USDC available right now. Enter ${x} or less.`
          : `That would take the ratio below 150%. You can borrow up to ${x} USDC.`
        : null;
  const noTrustline = m.trustline.kind === "ok" && !m.trustline.value;
  const trustChecking = m.trustline.kind === "checking";
  const newDebt = amount !== null && !error && amount > 0n ? debt + amount : null;
  usePreview(onPreview, previewOf(collateral, newDebt, price));
  const borrowedHash = mine && m.flow.phase === "settled" ? (m.flow.hash ?? "settled") : null;
  const stepTwo = borrowedHash !== null && receiveAs.kind !== "usdc" && m.lastAmount !== null && keptHash !== borrowedHash ? receiveAs : null;
  const hint = available?.limitedByPool ? (
    <>The pool has {usdcAmount(max)} USDC available right now.</>
  ) : (
    <>You can borrow up to {usdcAmount(max)} USDC more.</>
  );

  return (
    <form
      className="wz-stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (amount !== null && !error && !noTrustline && !trustChecking) m.borrow(amount);
      }}
    >
      {noTrustline && (
        <Notice tone="info" label="Step 1 of 2">
          <p>
            Add USDC to your Stellar wallet so it can receive what you borrow. One signature. Your wallet sets aside 0.5 XLM.
          </p>
          {m.trust.error ? <ErrorBox error={m.trust.error} context={{ flow: "trustline" }} label="USDC not added" /> : null}
          <div className="wz-actions">
            {m.trust.busy ? (
              <Status>Confirm in {m.stellar.walletName}. 0.5 XLM set aside.</Status>
            ) : (
              <button type="button" className="wz-btn wz-btn-gold" onClick={m.trust.add} disabled={m.otherTx}>
                Add USDC
              </button>
            )}
          </div>
        </Notice>
      )}
      <AmountField
        id={`${id}-borrow`}
        label="Borrow"
        value={value}
        onChange={setValue}
        maxLabel="Max safe"
        onMax={() => setValue(toFieldValue(max))}
        error={error}
        hint={hint}
        disabled={running}
      />
      <div className="wz-chips ln-presets">
        {[25n, 50n].map((p) => (
          <button key={String(p)} type="button" className="wz-chip" disabled={running} onClick={() => setValue(toFieldValue((max * p) / 100n))}>
            {String(p)}%
          </button>
        ))}
      </div>
      <After collateralSats={collateral} debt={newDebt} price={price} overLimit={overLimit} overPool={overPool} />
      <LiquidationEstimate collateralSats={collateral} debt={newDebt ?? debt} />
      {mine && (
        <TxResult
          flow={m.flow}
          context="borrow"
          walletName={m.stellar.walletName}
          onDismiss={m.dismiss}
          onCheckAgain={m.checkAgain}
          success={
            <>
              {stepTwo ? "Step 1 of 2 done. " : null}
              Borrowed{m.lastAmount !== null ? <> {usdcAmount(m.lastAmount)} USDC</> : null}. It&apos;s in your Stellar wallet.
            </>
          }
        />
      )}
      {stepTwo && m.lastAmount !== null ? (
        <ReceiveStep
          key={borrowedHash}
          intent={stepTwo}
          amount={m.lastAmount}
          walletName={m.stellar.walletName}
          onKeep={() => setKeptHash(borrowedHash)}
        />
      ) : running ? (
        <TxRunning flow={m.flow} walletName={m.stellar.walletName} />
      ) : mine && m.flow.phase === "timed_out" ? null : (
        <div className="wz-stack" style={{ gap: 8 }}>
          <div>
            <button
              type="submit"
              className="wz-btn wz-btn-gold"
              aria-disabled={amount === null || Boolean(error) || noTrustline || trustChecking}
              aria-describedby={trustChecking || noTrustline ? `${id}-why` : undefined}
            >
              {amount !== null && !error ? `Borrow ${formatUsdc(amount)} USDC` : "Borrow"}
            </button>
          </div>
          {(trustChecking || noTrustline) && (
            <p id={`${id}-why`} className="wz-hint">
              {trustChecking ? "Checking your wallet" : "Add USDC first."}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

// ── Repay ────────────────────────────────────────────────────────────────

export function RepayPanel({
  m,
  position,
  price,
  initial,
  onPreview,
}: {
  m: LoanModel;
  position: Position;
  price: bigint | null;
  initial: bigint | null;
  onPreview?: (bp: bigint | null) => void;
}) {
  const collateral = BigInt(position.collateralSats);
  const debt = BigInt(position.debtStroops);
  const wallet = readValue(m.walletUsdc);
  const all = wallet !== null && wallet < debt ? wallet : debt;
  const [value, setValue] = useState(() => (initial && initial > 0n ? toFieldValue(initial < all || all === 0n ? initial : all) : ""));
  const id = useId();
  const mine = m.action === "repay";
  const running = mine && isInFlight(m.flow);
  const parsed = value.trim() ? parseUsdcAmount(value) : null;
  const amount = parsed?.ok ? parsed.stroops : null;
  const error =
    parsed && !parsed.ok
      ? parsed.error
      : amount !== null && wallet !== null && amount > wallet
        ? `You have ${formatUsdc(wallet)} USDC in your wallet. Enter that or less.`
        : amount !== null && amount > debt
          ? `You owe ${formatUsdc(debt)} USDC. Enter that or less.`
          : null;
  const newDebt = amount !== null && !error && amount > 0n ? debt - amount : null;
  usePreview(onPreview, previewOf(collateral, newDebt, price));
  const walletText =
    m.walletUsdc.kind === "ok" ? (
      <>Wallet: {usdcAmount(m.walletUsdc.value)} USDC.</>
    ) : m.walletUsdc.kind === "checking" ? (
      <>Wallet: Checking...</>
    ) : (
      <>Wallet balance unavailable.</>
    );

  return (
    <form
      className="wz-stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (amount !== null && !error) m.repay(amount);
      }}
    >
      <AmountField
        id={`${id}-repay`}
        label="Repay"
        value={value}
        onChange={setValue}
        maxLabel={wallet !== null && wallet < debt ? "Max" : "Repay all"}
        onMax={() => setValue(toFieldValue(all))}
        error={error}
        hint={
          <>
            {walletText} You owe {usdcAmount(debt)} USDC.
          </>
        }
        disabled={running}
      />
      <After collateralSats={collateral} debt={newDebt} price={price} />
      {mine && (
        <TxResult
          flow={m.flow}
          context="repay"
          walletName={m.stellar.walletName}
          onDismiss={m.dismiss}
          onCheckAgain={m.checkAgain}
          success={
            debt === 0n ? (
              "Loan repaid. Your BTC is still locked. Release it below."
            ) : (
              <>Repaid{m.lastAmount !== null ? <> {usdcAmount(m.lastAmount)} USDC</> : null}.</>
            )
          }
        />
      )}
      {running ? (
        <TxRunning flow={m.flow} walletName={m.stellar.walletName} />
      ) : mine && m.flow.phase === "timed_out" ? null : (
        <div>
          <button type="submit" className="wz-btn wz-btn-gold" aria-disabled={amount === null || Boolean(error)}>
            {amount !== null && !error ? `Repay ${formatUsdc(amount)} USDC` : "Repay"}
          </button>
        </div>
      )}
    </form>
  );
}

// ── Release ──────────────────────────────────────────────────────────────

export function ReleasePanel({ m, position, neverBorrowed }: { m: LoanModel; position: Position; neverBorrowed: boolean }) {
  const reviewId = useId();
  const mine = m.action === "release";
  const step = mine ? releaseStepOf(m.flow) : null;
  const sats = BigInt(position.collateralSats);
  const btc = formatBtc(sats);
  const fee = m.releaseFeeSats;
  const blocker = releaseBlocker(position, { address: m.bitcoin.address, pubkey: m.bitcoin.pubkey });
  // The release pays the deposit key's own address; Writz builds it from the key on chain.
  const destination = position.btcPubkey ? releaseAddressOf(position.btcPubkey) : null;

  if (step !== null)
    return (
      <>
        <ol className="wz-steps" aria-label="Release progress">
          {RELEASE_STEPS.map((s, i) => (
            <li key={s} data-state={i < step ? "done" : i === step ? "now" : "next"} aria-current={i === step ? "step" : undefined}>
              {i === step ? <Spinner /> : <i aria-hidden="true" />}
              <span>{s}</span>
              {i < step && <span className="wz-sr">Done</span>}
            </li>
          ))}
        </ol>
        <p className="wz-sr" role="status">
          {RELEASE_STEPS[step]}
        </p>
      </>
    );

  if (mine && m.flow.phase === "settled")
    return (
      <Notice tone="positive" label="Sent" className="wz-enter">
        <p>Your release was sent to Bitcoin. It arrives after 1 Bitcoin confirmation.</p>
      </Notice>
    );

  return (
    <div className="wz-stack">
      <p>
        {neverBorrowed
          ? "Nothing is owed on this loan, so you can close it and release your BTC."
          : "Your loan is repaid, but your BTC stays locked until you release it."}
      </p>
      {mine && m.flow.phase === "failed" && <ErrorBox error={m.flow.error} context={{ flow: "release" }} label="Not released" />}
      {mine && m.flow.phase === "signature_cancelled" && (
        <Notice tone="neutral">
          <p>You declined in your wallet. Your BTC was not sent.</p>
        </Notice>
      )}
      {blocker === "no_wallet" ? (
        <Notice
          tone="info"
          actions={
            <button type="button" className="wz-btn wz-btn-gold" onClick={m.bitcoin.connect} disabled={m.bitcoin.connecting}>
              {m.bitcoin.connecting ? "Confirm in Xverse" : "Connect Xverse"}
            </button>
          }
        >
          <p>Connect Xverse to sign the release.</p>
        </Notice>
      ) : blocker === "wrong_account" ? (
        <Notice
          tone="warning"
          label="Different Bitcoin account"
          actions={
            <button type="button" className="wz-btn wz-btn-line" onClick={m.bitcoin.useOther}>
              Use a different account
            </button>
          }
        >
          <p>Connect the Bitcoin account that made this deposit. The BTC can only go back to it.</p>
        </Notice>
      ) : blocker === "wrong_network" ? (
        <Notice tone="warning" label="Wrong Bitcoin network">
          <p>
            This address isn&apos;t on {BTC_NETWORK_LABEL}. Switch Xverse to {BTC_NETWORK_LABEL} and connect again.
          </p>
        </Notice>
      ) : blocker === "missing_details" ? null : (
        <>
          <dl className="wz-well" id={reviewId}>
            <div className="wz-row wz-row-wrap">
              <dt>Send to your Bitcoin key&apos;s address</dt>
              <dd className="mono wz-break">{destination}</dd>
            </div>
            <div className="wz-row">
              <dt>Amount</dt>
              <dd className="mono">{btc} BTC</dd>
            </div>
            <div className="wz-row">
              <dt>Bitcoin network fee</dt>
              <dd className="mono">{fee !== null ? `about ${fee.toLocaleString("en-US")} sats` : "Checking..."}</dd>
            </div>
            <div className="wz-row">
              <dt>You receive</dt>
              <dd className="mono">{fee !== null ? `${formatBtc(sats - BigInt(fee))} BTC` : "Checking..."}</dd>
            </div>
          </dl>
          <p className="wz-hint">
            {neverBorrowed ? (
              <>
                You sign twice: in {m.stellar.walletName} to close the loan on {STELLAR}, then in Xverse.
              </>
            ) : (
              <>You sign once, in Xverse.</>
            )}{" "}
            Writz co-signs once the loan is closed. The Bitcoin network fee
            {fee !== null ? <>, about {fee.toLocaleString("en-US")} sats,</> : null} comes out of the released amount. The BTC goes only to
            the address of the Bitcoin key that made this deposit.
          </p>
          <SlideToConfirm
            key={m.flow.phase}
            label={`Slide to release ${btc} BTC`}
            armedLabel={`Press Enter again to release ${btc} BTC`}
            doneLabel={
              m.flow.phase === "awaiting_signature" && m.flow.wallet === "stellar"
                ? `Confirm in ${m.stellar.walletName}...`
                : "Confirm in Xverse..."
            }
            describedBy={reviewId}
            disabled={fee === null || destination === null || m.otherTx || m.catchingUp}
            onConfirm={m.release}
          />
        </>
      )}
    </div>
  );
}

// ── Closed and special states ────────────────────────────────────────────

export function ClosedNotice({ status, position }: { status: PositionStatus; position: Position }) {
  const btc = formatBtc(BigInt(position.collateralSats));
  switch (status.kind) {
    case "repaid_locked":
      if (status.neverBorrowed) return null;
      return (
        <Notice tone="info" label="Loan repaid">
          <p>
            <b>Your BTC is still locked.</b> Release it to your Bitcoin wallet. Writz co-signs.
          </p>
        </Notice>
      );
    case "releasing":
      return (
        <Notice tone="info" label="Releasing">
          <p>
            Your BTC is on its way{position.releaseAddress ? <> to <span className="mono wz-break">{position.releaseAddress}</span></> : null}. It
            arrives after 1 Bitcoin confirmation.
            {status.btcTxid ? (
              <>
                {" "}
                <ExternalLink href={btcTxUrl(status.btcTxid)}>View on mempool</ExternalLink>
              </>
            ) : null}
          </p>
        </Notice>
      );
    case "released":
      return (
        <Notice tone="positive" label="BTC released">
          <p>
            <span className="mono">{btc}</span> BTC, less the Bitcoin network fee, sent
            {position.releaseAddress ? <> to <span className="mono wz-break">{position.releaseAddress}</span></> : null}. It arrives after 1
            Bitcoin confirmation. <ExternalLink href={btcTxUrl(status.btcTxid)}>View on mempool</ExternalLink>
          </p>
        </Notice>
      );
    case "liquidated":
      return (
        <Notice tone="danger" label="Liquidated">
          <p>
            <b>This loan was liquidated.</b> Its collateral ratio fell below 120%, so a liquidator repaid your USDC debt and the loan is
            closed. You owe nothing on it.
          </p>
          <div className="wz-actions">
            {status.txHash ? (
              <ExternalLink href={stellarTxUrl(status.txHash)} className="wz-btn wz-btn-text">
                View the liquidation on {STELLAR}
              </ExternalLink>
            ) : null}
            <ExternalLink href={LIQUIDATION_DOCS_URL} className="wz-btn wz-btn-text">
              Read how liquidation works
            </ExternalLink>
          </div>
        </Notice>
      );
    case "registering":
    case "ready_to_register":
      return (
        <Notice
          tone="info"
          label="Registering on Stellar"
          actions={
            <Link href="/borrow/new" className="wz-btn wz-btn-line wz-btn-sm">
              Go to your deposit
            </Link>
          }
        >
          <p>This loan is still being registered on {STELLAR}. You can borrow once it is done.</p>
        </Notice>
      );
    default:
      return null;
  }
}

export function MissingDetails({ m, height }: { m: LoanModel; height: number | null }) {
  return (
    <Notice
      tone="warning"
      label="Bitcoin details missing"
      actions={
        <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={m.checkAgain}>
          Check again
        </button>
      }
    >
      <p>Writz couldn&apos;t read this deposit from Bitcoin yet, so it can&apos;t check whether your BTC is still locked.</p>
      <p>
        If it stays this way, after <BlockRef height={height} /> you can reclaim the BTC alone.{" "}
        <Link href={`/help/reclaim?loan=${m.n}`} className="wz-btn wz-btn-text wz-inline">
          How to reclaim
        </Link>
      </p>
    </Notice>
  );
}

// ── On this device ───────────────────────────────────────────────────────

const when = (at: number) =>
  new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function OnThisDevice({ items }: { items: ActivityItem[] }) {
  return (
    <Enter as="section" name="device" step={4} className="ln-device" aria-labelledby="on-device">
      <h2 id="on-device" className="ln-h2">
        On this device
      </h2>
      {items.length > 0 ? (
        <ul className="ln-txs">
          {items.map((t) => (
            <li key={t.hash} className="ln-tx">
              <b>{t.label}</b>
              <span className="ln-tx-chip" data-state={t.state}>
                {t.state === "pending" ? <Spinner /> : null}
                {t.state === "pending" ? "In progress" : "Done"}
              </span>
              <span className="ln-tx-end">
                {t.at ? <span>{when(t.at)}</span> : null}
                <TxLinkInline hash={t.hash} chain={t.chain} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No transactions for this loan on this device yet.</p>
      )}
      <p className="wz-muted">Full history needs the Writz indexer and is coming later.</p>
    </Enter>
  );
}
