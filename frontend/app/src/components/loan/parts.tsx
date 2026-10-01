"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { btcTxUrl, stellarTxUrl } from "@/lib/explorer";
import { hashOf, isInFlight, type FlowState } from "@/lib/flow/engine";
import { formatBtc, formatUsd, formatUsdc, shortAddress } from "@/lib/borrow/journey";
import { releaseBlocker } from "@/lib/flows/release";
import { LIQUIDATION_DOCS_URL, RECLAIM_DOCS_URL } from "@/lib/links";
import {
  RELEASE_STEPS,
  afterState,
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
import { networkName } from "@/lib/wallet/precheck";
import { useElapsed } from "@/components/redesign/hooks";
import { ErrorBox, ExternalLink, Notice, SlideToConfirm, Spinner, type Tone } from "@/components/redesign/ui";
import type { LoanModel } from "./model";

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

export const pct = (bp: bigint) => `${Math.round(Number(bp) / 100)}%`;

// ── Header ───────────────────────────────────────────────────────────────

export function badgeOf(status: PositionStatus): { label: string; tone: Tone } {
  switch (status.kind) {
    case "checking":
      return { label: "Checking...", tone: "neutral" };
    case "active":
      return { label: "Active", tone: "neutral" };
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
    case "closed_on_chain":
      return { label: "Closed on chain", tone: "info" };
    case "changed_elsewhere":
      return { label: "Changed on another device", tone: "info" };
    case "register_failed":
      return { label: "Finish deposit", tone: "warning" };
    default:
      return { label: "Registering on Stellar", tone: "info" };
  }
}

export function StatusBadge({ status }: { status: PositionStatus }) {
  const { label, tone } = badgeOf(status);
  return (
    <span className="ln-badge" data-tone={tone}>
      <i aria-hidden="true" />
      <span className="wz-sr">Status: </span>
      {label}
    </span>
  );
}

// ── Risk ─────────────────────────────────────────────────────────────────

const MIN = 100;
const MAX = 250;
const pos = (p: number) => `${Math.max(0, Math.min(100, ((p - MIN) / (MAX - MIN)) * 100))}%`;

/** Ratio scale from 100% to 250%, marks at 120% (liquidation) and 150% (borrow limit). */
export function HealthMeter({ ratioBp, health }: { ratioBp: bigint | null; health: Health | null }) {
  const p = ratioBp === null ? null : Number(ratioBp) / 100;
  const text =
    health === null
      ? "Collateral ratio checking"
      : health === "none"
        ? "No debt, nothing can be liquidated"
        : `Collateral ratio ${Math.round(p!)}%, ${HEALTH_LABEL[health].toLowerCase()}. Liquidation at 120%.`;
  const width = health === null ? "0%" : health === "none" ? "100%" : pos(p!);
  return (
    <div className="ln-meter">
      <div
        className="ln-meter-bar"
        role="meter"
        aria-label="Collateral ratio"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={p === null ? undefined : Math.min(MAX, Math.round(p))}
        aria-valuetext={text}
      >
        <span className="ln-meter-fill" data-tone={health ? HEALTH_TONE[health] : "neutral"} style={{ width }} />
        <span className="ln-mark" style={{ left: pos(120) }} />
        <span className="ln-mark" style={{ left: pos(150) }} />
      </div>
      <div className="ln-meter-scale" aria-hidden="true">
        <span style={{ left: pos(120) }}>120%</span>
        <span style={{ left: pos(150) }}>150%</span>
      </div>
    </div>
  );
}

export function HealthText({ ratioBp, health }: { ratioBp: bigint | null; health: Health | null }) {
  if (health === null)
    return (
      <p className="ln-health">
        <b>Checking...</b>
      </p>
    );
  return (
    <p className="ln-health" data-tone={HEALTH_TONE[health]}>
      <b className="mono">{ratioBp === null ? "No debt" : pct(ratioBp)}</b>
      {ratioBp !== null && <span>{HEALTH_LABEL[health]}</span>}
    </p>
  );
}

// ── Way out ──────────────────────────────────────────────────────────────

export function WayOut({ height, date, reclaimable }: { height: number; date: string | null; reclaimable: boolean }) {
  return (
    <section className="ln-out" aria-labelledby="way-out">
      <h2 id="way-out" className="wz-label">
        Your way out
      </h2>
      <p style={{ marginTop: 6 }}>
        {reclaimable ? (
          <>
            Bitcoin passed block <span className="mono">{height.toLocaleString("en-US")}</span>, so you can reclaim this BTC with your
            Bitcoin key alone, without Writz.{" "}
          </>
        ) : (
          <>
            If Writz stops, you can reclaim this BTC with your Bitcoin key alone after block{" "}
            <span className="mono">{height.toLocaleString("en-US")}</span>
            {date ? `, about ${date}` : ""}.{" "}
          </>
        )}
        <ExternalLink href={RECLAIM_DOCS_URL}>How to reclaim</ExternalLink>
      </p>
    </section>
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
      return <Status>Preparing... About 10 seconds. Keep this tab open.</Status>;
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
  context: "borrow" | "repay";
  onDismiss: () => void;
  onCheckAgain: () => void;
}) {
  const hash = hashOf(flow);
  switch (flow.phase) {
    case "settled":
      return (
        <Notice tone="positive" label="Done">
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

function AmountField({
  id,
  label,
  value,
  onChange,
  maxLabel,
  onMax,
  error,
  hint,
  disabled,
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
          autoComplete="off"
          placeholder="0.00"
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>USDC</span>
        <button type="button" className="ln-max" onClick={onMax} disabled={disabled}>
          {maxLabel}
        </button>
      </div>
      <p id={`${id}-hint`} className={error ? "wz-error" : "wz-hint"}>
        {error ?? hint}
      </p>
    </div>
  );
}

function After({ collateralSats, debt, price }: { collateralSats: bigint; debt: bigint; price: bigint | null }) {
  if (debt <= 0n) return <p className="ln-after">After this: loan repaid. Next, release your BTC.</p>;
  if (!price) return null;
  const a = afterState(collateralSats, debt, price);
  if (a.repaid) return null;
  return (
    <p className="ln-after">
      After this: ratio <b className="mono">{pct(a.ratioBp)}</b>, liquidated if BTC falls below{" "}
      <b className="mono">{formatUsd(a.liquidationPrice)}</b>.
    </p>
  );
}

function SignFirst({ m }: { m: LoanModel }) {
  const s = m.stellar;
  return (
    <div className="wz-stack" style={{ gap: 10 }}>
      <p className="wz-hint">
        Sign once so this app can use your loan keys. Your wallet asks you to sign a message. It is free and sends no transaction.
      </p>
      {s.unlockError ? <ErrorBox error={s.unlockError} label="Not signed" /> : null}
      <div>
        <button type="button" className="wz-btn wz-btn-gold" onClick={s.unlock} disabled={s.unlocking}>
          {s.unlocking ? `Confirm in ${s.walletName}` : "Sign to continue"}
        </button>
      </div>
    </div>
  );
}

const usdcAmount = (s: bigint) => <span className="mono">{formatUsdc(s)}</span>;

// ── Borrow ───────────────────────────────────────────────────────────────

export function BorrowPanel({
  m,
  position,
  available,
  price,
}: {
  m: LoanModel;
  position: Position;
  available: Available | null;
  price: bigint | null;
}) {
  const [value, setValue] = useState("");
  const id = useId();
  const mine = m.action === "borrow";
  const running = mine && isInFlight(m.flow);
  const collateral = BigInt(position.collateralSats);
  const debt = BigInt(position.debtStroops);
  const max = available?.stroops ?? 0n;
  const parsed = value.trim() ? parseUsdcAmount(value) : null;
  const amount = parsed?.ok ? parsed.stroops : null;
  const x = formatUsdc(max);
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
      <div className="ln-presets">
        {[25n, 50n].map((p) => (
          <button key={String(p)} type="button" disabled={running} onClick={() => setValue(toFieldValue((max * p) / 100n))}>
            {String(p)}%
          </button>
        ))}
      </div>
      {amount !== null && !error && <After collateralSats={collateral} debt={debt + amount} price={price} />}
      {mine && (
        <TxResult
          flow={m.flow}
          context="borrow"
          walletName={m.stellar.walletName}
          onDismiss={m.dismiss}
          onCheckAgain={m.checkAgain}
          success={
            <>
              Borrowed{m.lastAmount !== null ? <> {usdcAmount(m.lastAmount)} USDC</> : null}. It&apos;s in your Stellar wallet.
            </>
          }
        />
      )}
      {running ? (
        <TxRunning flow={m.flow} walletName={m.stellar.walletName} />
      ) : !m.stellar.keysReady ? (
        <SignFirst m={m} />
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
}: {
  m: LoanModel;
  position: Position;
  price: bigint | null;
  initial: bigint | null;
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
      {amount !== null && !error && <After collateralSats={collateral} debt={debt - amount} price={price} />}
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
      ) : !m.stellar.keysReady ? (
        <SignFirst m={m} />
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

  if (step !== null)
    return (
      <ol className="wz-steps" aria-label="Release progress">
        {RELEASE_STEPS.map((s, i) => (
          <li key={s} data-state={i < step ? "done" : i === step ? "now" : "next"} aria-current={i === step ? "step" : undefined}>
            {i === step ? <Spinner /> : <i aria-hidden="true" />}
            <span>{s}</span>
            {i < step && <span className="wz-sr">Done</span>}
          </li>
        ))}
        <li className="wz-sr" role="status">
          {RELEASE_STEPS[step]}
        </li>
      </ol>
    );

  if (mine && m.flow.phase === "settled")
    return (
      <Notice tone="positive" label="Sent">
        <p>Your release was sent to Bitcoin. It arrives after 1 Bitcoin confirmation.</p>
      </Notice>
    );

  return (
    <div className="wz-stack">
      <p>
        {neverBorrowed
          ? "Nothing is owed on this loan, so you can release your BTC."
          : "Your loan is repaid, but your BTC stays locked until you release it."}
      </p>
      {mine && m.flow.phase === "failed" && <ErrorBox error={m.flow.error} context={{ flow: "release" }} label="Not released" />}
      {mine && m.flow.phase === "signature_cancelled" && (
        <Notice tone="neutral">
          <p>You declined in Xverse. Nothing was sent.</p>
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
              <dt>Send to your Xverse wallet</dt>
              <dd className="mono wz-break">{m.bitcoin.address}</dd>
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
            You sign in Xverse and Writz co-signs. The Bitcoin network fee
            {fee !== null ? <>, about {fee.toLocaleString("en-US")} sats,</> : null} comes out of the released amount. The BTC goes only to
            the wallet that made this deposit.
          </p>
          {m.stellar.keysReady ? (
            <SlideToConfirm
              key={m.flow.phase}
              label={`Slide to release ${btc} BTC`}
              armedLabel={`Press Enter again to release ${btc} BTC`}
              doneLabel="Confirm in Xverse..."
              describedBy={reviewId}
              disabled={fee === null || m.otherTx || m.catchingUp}
              onConfirm={m.release}
            />
          ) : (
            <SignFirst m={m} />
          )}
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
            <b>Your BTC is still locked.</b> Release it to your Xverse wallet. Writz co-signs.
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
            <ExternalLink href={stellarTxUrl(status.txHash)}>View the liquidation on {STELLAR}</ExternalLink>
            <ExternalLink href={LIQUIDATION_DOCS_URL}>Read how liquidation works</ExternalLink>
          </div>
        </Notice>
      );
    case "closed_on_chain":
      return (
        <Notice tone="info" label="Closed on chain" actions={<FindLoans />}>
          <p>This loan was closed on {STELLAR}. Checking what closed it...</p>
        </Notice>
      );
    case "changed_elsewhere":
      return (
        <Notice tone="info" label="Changed on another device" actions={<FindLoans />}>
          <p>This loan changed on another device. Find your loans again to see where it stands.</p>
        </Notice>
      );
    case "registering":
    case "register_failed":
    case "ready_to_register":
    case "proving":
      return (
        <Notice
          tone={status.kind === "register_failed" ? "warning" : "info"}
          label={status.kind === "register_failed" ? "Finish deposit" : "Registering on Stellar"}
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

function FindLoans() {
  return (
    <Link href="/" className="wz-btn wz-btn-line wz-btn-sm">
      Find my loans
    </Link>
  );
}

export function MissingDetails({ m, height }: { m: LoanModel; height: number }) {
  return (
    <Notice tone="warning" label="Bitcoin details missing">
      <p>This device doesn&apos;t have the Bitcoin details for this loan, so it can&apos;t build the release.</p>
      <ul className="fo-need" style={{ marginTop: 4 }}>
        <li>Open Writz on the device you deposited from.</li>
        <li>Or import your loan backup on this device.</li>
        <li>
          Or, after block <span className="mono">{height.toLocaleString("en-US")}</span>, reclaim the BTC alone.{" "}
          <ExternalLink href={RECLAIM_DOCS_URL}>How to reclaim</ExternalLink>
        </li>
      </ul>
      {m.importState.error ? <ErrorBox error={m.importState.error} label="Backup not imported" /> : null}
      {m.importState.done ? <p>Backup imported.</p> : null}
      <div className="wz-actions">
        <label className="wz-btn wz-btn-line wz-btn-sm ln-file">
          {m.importState.busy ? "Importing..." : "Import loan backup"}
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) m.importBackup(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </Notice>
  );
}

// ── On this device ───────────────────────────────────────────────────────

const when = (at: number) =>
  new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function OnThisDevice({ items }: { items: ActivityItem[] }) {
  return (
    <section className="ln-device" aria-labelledby="on-device">
      <h2 id="on-device" className="wz-label">
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
        <p className="wz-hint">No transactions for this loan on this device yet.</p>
      )}
      <p className="wz-hint">Full history needs the Writz indexer and is coming later.</p>
    </section>
  );
}
