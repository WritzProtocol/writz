"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { btcTxUrl, stellarTxUrl } from "@/lib/explorer";
import { hashOf } from "@/lib/flow/engine";
import { isSignatureRejected } from "@/lib/wallet/rejection";
import {
  formatBtc,
  formatUsd,
  formatUsdc,
  liquidationPriceStroops,
  maxBorrowStroops,
  parseBtcAmount,
  shortAddress,
  timeLeft,
} from "@/lib/borrow/journey";
import { useElapsed } from "@/components/redesign/hooks";
import { ConfirmationSlots, ErrorBox, ExternalLink, Notice, SlideToConfirm, Spinner } from "@/components/redesign/ui";
import type { JourneyModel } from "./model";

const ON_TESTNET = config.target !== "mainnet";
const FAUCETS = [
  { label: "bitcoinsignetfaucet.com", href: "https://bitcoinsignetfaucet.com/" },
  { label: "signet.dcorral.com", href: "https://signet.dcorral.com/" },
];

function Status({ children, spinning = true }: { children: React.ReactNode; spinning?: boolean }) {
  return (
    <p className="wz-status" aria-live="polite">
      {spinning ? <Spinner /> : null}
      <span>{children}</span>
    </p>
  );
}

function Primary({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <div>
      <button type="button" className="wz-btn wz-btn-gold" {...props}>
        {children}
      </button>
    </div>
  );
}

function WalletCard({ icon, name, detail }: { icon: string; name: string; detail: React.ReactNode }) {
  return (
    <div className="wz-wallet">
      <span className="wz-wallet-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <b>{name}</b>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function TxHash({ hash, chain }: { hash: string; chain: "stellar" | "bitcoin" }) {
  return (
    <ExternalLink href={chain === "stellar" ? stellarTxUrl(hash) : btcTxUrl(hash)} className="wz-link mono">
      {shortAddress(hash, 6, 4)}
    </ExternalLink>
  );
}

// ── 1 Amount ─────────────────────────────────────────────────────────────

export function AmountStep({ m }: { m: JourneyModel }) {
  const { amount } = m;
  const parsed = parseBtcAmount(amount.value);
  const sats = parsed.ok ? parsed.sats : null;
  const invalid = Boolean(amount.error);
  const price = m.priceStroops;

  return (
    <form
      className="wz-stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        amount.submit();
      }}
    >
      <label htmlFor="amount" className="wz-label">
        Amount in BTC
      </label>
      <div className="wz-field" data-invalid={invalid}>
        <input
          id="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.05"
          value={amount.value}
          aria-invalid={invalid}
          aria-describedby={invalid ? "amount-error" : "amount-hint"}
          onChange={(e) => amount.set(e.target.value)}
        />
        <span>BTC</span>
      </div>
      {invalid ? (
        <p id="amount-error" className="wz-error">
          {amount.error}
        </p>
      ) : (
        <p id="amount-hint" className="wz-hint">
          {sats ? <span className="mono">= {sats.toLocaleString("en-US")} sats. </span> : null}
          Minimum 0.00010000 BTC.
          {amount.balanceSats !== null ? (
            <>
              {" "}
              You have <span className="mono">{formatBtc(amount.balanceSats)}</span> BTC in Xverse.
            </>
          ) : null}
        </p>
      )}
      {price ? (
        <dl className="wz-well">
          <div className="wz-row">
            <dt>You can borrow up to</dt>
            <dd className="mono">{sats ? `${formatUsdc(maxBorrowStroops(sats, price))} USDC` : "-"}</dd>
          </div>
          <div className="wz-row">
            <dt>Liquidated if BTC falls below</dt>
            <dd className="mono">{formatUsd(liquidationPriceStroops(price))}</dd>
          </div>
          <div className="wz-row">
            <dt>BTC price</dt>
            <dd>
              <span className="mono">{formatUsd(price)}</span> <small className="wz-muted">oracle price</small>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="wz-hint">BTC price unavailable.</p>
      )}
      <p className="wz-hint">
        The liquidation price assumes you borrow the full amount.
        {m.review.exitDate ? ` If Writz stops, you can reclaim your BTC alone after about ${m.review.exitDate}.` : ""}
      </p>
      <div>
        <button type="submit" className="wz-btn wz-btn-gold">
          Continue
        </button>
      </div>
    </form>
  );
}

// ── 2 Stellar wallet ─────────────────────────────────────────────────────

export function StellarStep({ m }: { m: JourneyModel }) {
  const s = m.stellar;
  const slow = useElapsed(s.connecting || s.loans === "signing", 10_000);
  const editing = s.ready;

  return (
    <div className="wz-stack">
      <p>Your Stellar wallet receives the USDC and signs loan actions. Writz never sees your keys.</p>

      {!s.address ? (
        <>
          {s.connectError &&
            (s.connectError.declined ? (
              <Notice tone="neutral">You declined in your wallet. Nothing was shared.</Notice>
            ) : (
              <Notice tone="warning" label="Not connected">
                Your wallet didn&apos;t connect. Try again, or open it from your browser toolbar first.
              </Notice>
            ))}
          <WalletCard icon="F" name="Freighter" detail="Also works with xBull, Lobstr and others" />
          {s.connecting ? (
            <>
              <Status>Confirm in your wallet</Status>
              {slow && <p className="wz-hint">Didn&apos;t see it? Open your wallet from your browser toolbar.</p>}
            </>
          ) : (
            <Primary onClick={s.connect}>Connect Stellar wallet</Primary>
          )}
        </>
      ) : (
        <>
          <WalletCard icon="S" name={s.walletName === "your wallet" ? "Stellar wallet" : s.walletName} detail={<span className="mono">{shortAddress(s.address, 6, 6)}</span>} />
          <StellarReadiness m={m} slow={slow} />
          {editing && (
            <div className="wz-actions">
              <button type="button" className="wz-btn wz-btn-gold" onClick={m.finishEdit}>
                Continue
              </button>
              <button type="button" className="wz-btn wz-btn-line" onClick={s.useOther}>
                Use a different wallet
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Only the first failing check shows, with its one action. */
function StellarReadiness({ m, slow }: { m: JourneyModel; slow: boolean }) {
  const s = m.stellar;
  if (s.wrongNetwork) {
    return (
      <>
        <Notice tone="warning" label="Wrong network">
          Your wallet is on {s.wrongNetwork}. Writz runs on Stellar testnet. Switch network in {s.walletName}.
        </Notice>
        <Primary disabled aria-disabled="true">
          Continue
        </Primary>
      </>
    );
  }
  if (s.funding.kind === "checking") return <Status>Checking your Stellar account</Status>;
  const funding = s.funding.kind === "ok" ? s.funding.value : null;
  const fundButton = (gold: boolean) =>
    ON_TESTNET ? (
      <button type="button" className={`wz-btn ${gold ? "wz-btn-gold" : "wz-btn-line"}`} disabled={s.fundBusy} onClick={s.fund}>
        {s.fundBusy ? (
          <>
            <Spinner /> Funding
          </>
        ) : (
          "Fund with Friendbot"
        )}
      </button>
    ) : null;

  if (funding?.kind === "unfunded") {
    return (
      <>
        <Notice
          tone="warning"
          label="Not funded"
          actions={
            <>
              {fundButton(true)}
              <button type="button" className="wz-btn wz-btn-line" onClick={s.recheckFunding}>
                Check again
              </button>
            </>
          }
        >
          This Stellar account isn&apos;t funded yet.
        </Notice>
        {s.fundError ? <ErrorBox error={s.fundError} label="Friendbot didn't fund it" tone="warning" /> : null}
      </>
    );
  }
  if (funding?.kind === "low" && !s.lowAck) {
    return (
      <Notice
        tone="warning"
        label="Low XLM"
        actions={
          <>
            <button type="button" className="wz-btn wz-btn-gold" onClick={s.ackLow}>
              Continue
            </button>
            {fundButton(false)}
          </>
        }
      >
        You have <span className="mono">{funding.xlm}</span> XLM. Keep at least 2 XLM for fees and the USDC deposit.
      </Notice>
    );
  }

  switch (s.loans) {
    case "unsigned":
    case "signing":
      return (
        <>
          {s.signError ? (
            isSignatureRejected(s.signError) ? (
              <Notice tone="neutral">You declined in {s.walletName}. Nothing was sent.</Notice>
            ) : (
              <ErrorBox error={s.signError} context={{ flow: "recover" }} />
            )
          ) : null}
          <Notice tone="info">
            {s.walletName === "your wallet" ? "Your wallet" : s.walletName} will ask you to sign a message. It is free
            and sends no transaction. It lets this app find loans made with this wallet.
          </Notice>
          {s.loans === "signing" ? (
            <>
              <Status>Confirm in {s.walletName}</Status>
              {slow && <p className="wz-hint">Didn&apos;t see it? Open {s.walletName} from your browser toolbar.</p>}
            </>
          ) : (
            <Primary onClick={s.sign}>Sign to find my loans</Primary>
          )}
        </>
      );
    case "finding":
      return <Status>Finding your loans</Status>;
    case "failed":
      return (
        <ErrorBox
          error={s.loansError}
          context={{ flow: "recover" }}
          label="Couldn't find your loans"
          tone="warning"
          actions={
            <button type="button" className="wz-btn wz-btn-gold" onClick={s.retryFind}>
              Try again
            </button>
          }
        />
      );
    default:
      return s.loansCount > 0 ? (
        <Notice tone="info">
          You have {s.loansCount} {s.loansCount === 1 ? "loan" : "loans"}. This adds a new one.
        </Notice>
      ) : null;
  }
}

// ── 3 Bitcoin wallet ─────────────────────────────────────────────────────

export function BitcoinStep({ m }: { m: JourneyModel }) {
  const b = m.bitcoin;
  const slow = useElapsed(b.connecting, 10_000);
  const sats = m.sats;
  const short = b.balance?.kind === "ok" && sats !== null && b.balance.value < sats;

  return (
    <div className="wz-stack">
      <p>Xverse holds the BTC you lock. Its key builds your lock address, so only you and Writz together can move it.</p>
      {m.stellar.loansCount > 0 && !b.address && (
        <Notice tone="info">
          You have {m.stellar.loansCount} {m.stellar.loansCount === 1 ? "loan" : "loans"}. This adds a new one.
        </Notice>
      )}

      {!b.address ? (
        <>
          {b.error?.kind === "declined" && <Notice tone="neutral">You declined in Xverse. Nothing was shared.</Notice>}
          {b.error?.kind === "network" && (
            <Notice tone="warning" label="Wrong network">
              Xverse is on {networkFrom(b.error.message)}. Switch it to {BTC_NETWORK_LABEL}, then connect again.
            </Notice>
          )}
          {b.error?.kind === "other" && <ErrorBox error={new Error(b.error.raw)} label="Xverse didn't connect" tone="warning" />}
          <WalletCard icon="X" name="Xverse" detail={BTC_NETWORK_LABEL} />
          {b.connecting ? (
            <>
              <Status>Confirm in Xverse</Status>
              {slow && <p className="wz-hint">Didn&apos;t see it? Open Xverse from your browser toolbar.</p>}
            </>
          ) : (
            <Primary onClick={b.connect}>Connect Xverse</Primary>
          )}
        </>
      ) : (
        <>
          <WalletCard icon="X" name="Xverse" detail={<span className="mono">{shortAddress(b.address, 8, 6)}</span>} />
          {b.balance?.kind === "checking" && <Status>Checking your balance</Status>}
          {short && b.balance?.kind === "ok" && (
            <Notice
              tone="warning"
              label="Not enough BTC"
              actions={
                <>
                  <button type="button" className="wz-btn wz-btn-gold" onClick={b.recheck}>
                    Check balance again
                  </button>
                  <button type="button" className="wz-btn wz-btn-text" onClick={() => m.newDevice.setOpen(true)}>
                    I already sent BTC
                  </button>
                </>
              }
            >
              <p>
                You have <span className="mono">{formatBtc(b.balance.value)}</span> BTC on {BTC_NETWORK_LABEL}.
                {ON_TESTNET
                  ? ` Need test BTC? Get free ${BTC_NETWORK_LABEL} BTC into your Xverse wallet, then select Check balance again.`
                  : " Add BTC to Xverse, then select Check balance again."}
              </p>
              {ON_TESTNET && (
                <p className="wz-actions" style={{ marginTop: 8 }}>
                  {FAUCETS.map((f) => (
                    <ExternalLink key={f.href} href={f.href}>
                      {f.label}
                    </ExternalLink>
                  ))}
                </p>
              )}
            </Notice>
          )}
          {short && m.newDevice.open && <NewDevicePanel m={m} />}
          {b.ready && (
            <div className="wz-actions">
              <button type="button" className="wz-btn wz-btn-gold" onClick={m.finishEdit}>
                Continue
              </button>
              <button type="button" className="wz-btn wz-btn-line" onClick={b.useOther}>
                Use a different wallet
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function networkFrom(message: string): string {
  const active = /currently (\w+)/.exec(message)?.[1];
  return active ? `Bitcoin ${active.toLowerCase()}` : "another network";
}

// ── 4 Review and send ────────────────────────────────────────────────────

export function ReviewStep({ m }: { m: JourneyModel }) {
  const { review: r, deposit } = m;
  const flow = deposit.flow;
  const sats = m.sats ?? 0n;
  const btc = formatBtc(sats);
  const fee = r.feeSats ? `of about ${r.feeSats.toLocaleString("en-US")} sats` : "set in Xverse";
  const height = r.timelockHeight.toLocaleString("en-US");
  const [copied, setCopied] = useState(false);

  if (r.tooClose) {
    return (
      <Notice tone="danger" label="Deposits paused">
        Deposits are paused: the lock date is too close.
      </Notice>
    );
  }

  return (
    <div className="wz-stack">
      <dl className="wz-well" id="review-summary">
        <div className="wz-row">
          <dt>You lock</dt>
          <dd>
            <span className="mono">{btc} BTC</span>
            <br />
            <small className="wz-muted">plus a network fee {fee}</small>
          </dd>
        </div>
        <div className="wz-row wz-row-wrap">
          <dt>To your lock address</dt>
          <dd className="wz-stack" style={{ gap: 8 }}>
            <span className="mono wz-break">{r.lockAddress ?? "Connect Xverse first"}</span>
            {r.lockAddress && (
              <span className="wz-actions">
                <button
                  type="button"
                  className="wz-btn wz-btn-line wz-btn-sm"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(r.lockAddress!)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      })
                      .catch(() => {});
                  }}
                >
                  {copied ? "Copied" : "Copy address"}
                </button>
                <span className="wz-sr" aria-live="polite">
                  {copied ? "Copied" : ""}
                </span>
              </span>
            )}
            <details className="wz-hint">
              <summary style={{ cursor: "pointer" }}>What is this?</summary>
              <p style={{ marginTop: 6 }}>
                Only your key and Writz&apos;s together can move BTC from this address. After Bitcoin block {height}
                {r.exitDate ? `, about ${r.exitDate},` : ""} your key alone can.
              </p>
            </details>
          </dd>
        </div>
        <div className="wz-row">
          <dt>You can borrow</dt>
          <dd className="mono">{m.priceStroops ? `up to ${formatUsdc(maxBorrowStroops(sats, m.priceStroops))} USDC` : "BTC price unavailable"}</dd>
        </div>
        <div className="wz-row">
          <dt>Release</dt>
          <dd>Writz co-signs the release when your loan is repaid.</dd>
        </div>
        <div className="wz-row">
          <dt>Your way out</dt>
          <dd>
            If Writz is unavailable, you alone can reclaim after {r.exitDate ? `about ${r.exitDate} ` : ""}
            <span className="mono wz-muted">(block {height})</span>
          </dd>
        </div>
        <div className="wz-row">
          <dt>Network</dt>
          <dd>
            {BTC_NETWORK_LABEL}.{ON_TESTNET ? " Test funds only." : ""}
          </dd>
        </div>
      </dl>

      {m.newDevice.open ? (
        <NewDevicePanel m={m} />
      ) : flow.phase === "awaiting_signature" && flow.wallet === "bitcoin" ? (
        <Status>
          Confirm in Xverse. It will ask you to send <span className="mono">{btc}</span> BTC plus a network fee {fee}.
        </Status>
      ) : flow.phase === "preparing" ? (
        <Status>Getting your deposit ready</Status>
      ) : (
        <div className="wz-stack">
          {flow.phase === "signature_cancelled" && flow.wallet === "bitcoin" && (
            <Notice tone="neutral">You declined in Xverse. No BTC was sent.</Notice>
          )}
          {flow.phase === "failed" && <ErrorBox error={flow.error} context={{ flow: "deposit" }} />}
          <p className="wz-hint">Writz cannot recover your Bitcoin key. Keep its recovery phrase.</p>
          <label className="wz-check">
            <input type="checkbox" checked={r.ack} onChange={(e) => r.setAck(e.target.checked)} />
            <span>I understand my BTC stays locked until I repay and release it, or until block {height}.</span>
          </label>
          <SlideToConfirm
            key={r.slideKey}
            label={`Slide to send ${btc} BTC`}
            armedLabel={`Press Enter again to send ${btc} BTC`}
            doneLabel="Confirm in Xverse…"
            disabled={!r.ack || !r.lockAddress}
            describedBy="review-summary"
            onConfirm={r.send}
          />
          {!r.ack && <p className="wz-hint">Tick the box above to send.</p>}
          <button type="button" className="wz-btn wz-btn-text" style={{ alignSelf: "flex-start" }} onClick={() => m.newDevice.setOpen(true)}>
            I already sent BTC
          </button>
        </div>
      )}
    </div>
  );
}

function NewDevicePanel({ m }: { m: JourneyModel }) {
  const n = m.newDevice;
  const input = useRef<HTMLInputElement>(null);
  const c = n.check;
  const invalid = c.kind === "invalid";

  return (
    <form
      className="wz-stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        n.submit();
      }}
    >
      <label htmlFor="txid" className="wz-label">
        Bitcoin transaction ID
      </label>
      <div className="wz-field" data-size="sm" data-invalid={invalid || c.kind === "no_output"}>
        <input
          ref={input}
          id="txid"
          autoComplete="off"
          spellCheck={false}
          value={n.txid}
          aria-invalid={invalid}
          aria-describedby="txid-help"
          onChange={(e) => n.setTxid(e.target.value)}
        />
      </div>
      <p id="txid-help" className={invalid ? "wz-error" : "wz-hint"}>
        {invalid ? "Enter the 64-character ID from Xverse." : "Paste the ID from Xverse. The amount is read from Bitcoin."}
      </p>
      {c.kind === "checking" && <Status>Looking for it on Bitcoin</Status>}
      {c.kind === "saving" && <Status>Saving your progress</Status>}
      {c.kind === "found" && (
        <Notice
          tone="positive"
          label="Found"
          actions={
            <button type="button" className="wz-btn wz-btn-gold" onClick={n.confirm}>
              Continue
            </button>
          }
        >
          <span className="mono">{formatBtc(c.sats)}</span> BTC found, paid to your lock address.
        </Notice>
      )}
      {c.kind === "no_output" && (
        <Notice
          tone="danger"
          label="Doesn't match"
          alert
          actions={
            <button type="button" className="wz-btn wz-btn-line" onClick={() => input.current?.focus()}>
              Check the ID
            </button>
          }
        >
          This transaction doesn&apos;t pay a Writz lock address for this Bitcoin wallet.
        </Notice>
      )}
      {c.kind === "error" && <ErrorBox error={c.error} context={{ flow: "deposit" }} tone="warning" label="Not found yet" />}
      <div className="wz-actions">
        {c.kind !== "found" && (
          <button type="submit" className="wz-btn wz-btn-gold" disabled={c.kind === "checking" || c.kind === "saving"}>
            Find my deposit
          </button>
        )}
        <button type="button" className="wz-btn wz-btn-text" onClick={() => n.setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── 5 Wait for Bitcoin ───────────────────────────────────────────────────

/** n of m from the derived status, falling back to the relayer count the flow reports. */
export function confirmationCount(m: JourneyModel): { n: number; m: number } | null {
  const s = m.deposit.status.status;
  const flow = m.deposit.flow;
  if (s.kind === "confirming") return { n: s.n, m: s.m };
  if (s.kind === "btc_sent" || s.kind === "btc_unseen") return { n: 0, m: m.deposit.m };
  if (s.kind === "ready_to_register") return { n: m.deposit.m, m: m.deposit.m };
  if (flow.phase === "waiting_btc") return { n: flow.confirmations, m: flow.required };
  return null;
}

export function WaitStep({ m }: { m: JourneyModel }) {
  const d = m.deposit;
  const pd = d.pending;
  const count = confirmationCount(m);
  const s = d.status.status;
  const relayerBehind = s.kind === "confirming" && s.relayerBehind;
  const saving = d.flow.phase === "preparing" && d.flow.step === "locating_output" && s.kind !== "btc_unseen";

  return (
    <div className="wz-stack">
      {(d.foundOnLoad || d.secondBlocked) && (
        <Notice tone="info">
          You have a deposit in progress.{d.secondBlocked ? " Finish this deposit first." : ""}
        </Notice>
      )}
      {d.drivenElsewhere && <Notice tone="info">This deposit is running in another tab.</Notice>}
      {saving && <Status>BTC sent. Saving your progress</Status>}

      {count ? (
        <>
          <ConfirmationSlots n={count.n} m={count.m} />
          <div className="wz-spread">
            <p className="wz-strong" aria-live="polite">
              {relayerBehind
                ? `${count.m} of ${count.m} confirmations. Waiting for the Writz relayer to see it.`
                : count.n === 0
                  ? "Waiting for the first confirmation."
                  : `${count.n} of ${count.m} confirmations.`}
            </p>
            {!relayerBehind && <p className="wz-muted">{timeLeft(count.m - count.n)}</p>}
          </div>
        </>
      ) : (
        <>
          <div className="wz-skeleton" style={{ height: 44 }} />
          <p className="wz-muted">Checking…</p>
        </>
      )}

      {s.kind === "btc_unseen" && (
        <Notice
          tone="warning"
          label="Not seen yet"
          actions={
            <button type="button" className="wz-btn wz-btn-gold" onClick={d.recheck}>
              Check again
            </button>
          }
        >
          Bitcoin hasn&apos;t seen this transaction yet. If Xverse shows it as sent, wait a few more minutes.
        </Notice>
      )}
      {d.relayerUnreachable && (
        <p className="wz-hint" role="status">
          Can&apos;t reach the Writz relayer. Retrying on its own. Your BTC is safe on Bitcoin.
        </p>
      )}
      {d.flow.phase === "failed" && (
        <ErrorBox
          error={d.flow.error}
          context={{ flow: "deposit" }}
          tone="warning"
          label="Needs attention"
          actions={
            <button type="button" className="wz-btn wz-btn-line" onClick={d.recheck}>
              Check again
            </button>
          }
        />
      )}

      <p className="wz-hint">
        You can close this page. Your progress is saved in this browser for this Stellar wallet.
        {pd ? (
          <>
            {" "}
            <ExternalLink href={btcTxUrl(pd.btcTxid)}>View on mempool</ExternalLink>
          </>
        ) : null}
      </p>
      {pd && <p className="wz-hint mono">{shortAddress(pd.btcTxid, 10, 8)}</p>}
    </div>
  );
}

// ── 6 Register on Stellar ────────────────────────────────────────────────

type RegisterView =
  | { kind: "sign_first" }
  | { kind: "ready" }
  | { kind: "progress"; active: 0 | 1 | 2 | 3 }
  | { kind: "cancelled" }
  | { kind: "attention"; failed: boolean }
  | { kind: "timed_out" }
  | { kind: "failed"; error: unknown };

function registerView(m: JourneyModel): RegisterView {
  const { flow, status, unlocked } = m.deposit;
  const s = status.status;
  switch (flow.phase) {
    case "proving":
      return { kind: "progress", active: 0 };
    case "preparing":
      return { kind: "progress", active: 0 };
    case "awaiting_signature":
      return { kind: "progress", active: 1 };
    case "submitted":
      return { kind: "progress", active: 2 };
    case "post_processing":
      return { kind: "progress", active: 3 };
    case "signature_cancelled":
      return { kind: "cancelled" };
    case "needs_attention":
      return { kind: "attention", failed: Boolean(flow.error) || s.kind === "register_failed" };
    case "timed_out":
      return { kind: "timed_out" };
    case "failed":
      return { kind: "failed", error: flow.error };
  }
  if (s.kind === "register_failed") return { kind: "attention", failed: true };
  if (s.kind === "proving") return { kind: "progress", active: 0 };
  if (s.kind === "registering") return { kind: "progress", active: s.step === 1 ? 2 : 3 };
  return unlocked ? { kind: "ready" } : { kind: "sign_first" };
}

export function registerQuestion(m: JourneyModel): string {
  const v = registerView(m);
  if (v.kind === "progress") return "Registering your deposit on Stellar";
  if (v.kind === "attention") return "One more step adds your loan";
  return "One signature left";
}

export function RegisterStep({ m }: { m: JourneyModel }) {
  const d = m.deposit;
  const v = registerView(m);
  const wallet = m.stellar.walletName;
  const hash = hashOf(d.flow) ?? d.pending?.stellarTxHash;
  const slow = useElapsed(v.kind === "progress" && v.active === 1, 10_000);
  const blocked = d.otherTx ? "Waiting for your other transaction (in another tab)." : null;

  const lines = [
    "Preparing your deposit in this browser. About 10 seconds. Keep this tab open.",
    `Confirm in ${wallet}. Fee about 0.01 XLM.`,
    "Recording your deposit on Stellar (step 1 of 2)",
    "Adding your loan (step 2 of 2)",
  ];

  return (
    <div className="wz-stack">
      {(d.foundOnLoad || d.secondBlocked) && v.kind !== "progress" && (
        <Notice tone="info">
          You have a deposit in progress.{d.secondBlocked ? " Finish this deposit first." : ""}
        </Notice>
      )}
      {d.drivenElsewhere && <Notice tone="info">This deposit is running in another tab.</Notice>}

      {v.kind === "sign_first" && (
        <>
          <Notice tone="positive" label="BTC locked">
            Your BTC is locked. Before the last step, sign the free message so this app can load this deposit&apos;s keys.
          </Notice>
          {m.stellar.loans === "signing" ? <Status>Confirm in {wallet}</Status> : <Primary onClick={m.stellar.sign}>Sign to find my loans</Primary>}
        </>
      )}

      {v.kind === "ready" && (
        <>
          <Notice tone="positive" label="BTC locked">
            Your BTC is locked. One signature left. Writz never signs for you.
          </Notice>
          <Primary onClick={d.register} disabled={Boolean(blocked)} aria-describedby={blocked ? "register-blocked" : undefined}>
            Register on Stellar
          </Primary>
          {blocked && (
            <p id="register-blocked" className="wz-hint">
              {blocked}
            </p>
          )}
        </>
      )}

      {v.kind === "progress" && (
        <>
          <ol className="wz-steps" aria-live="polite">
            {lines.map((text, i) => (
              <li key={i} data-state={i < v.active ? "done" : i === v.active ? "now" : "next"}>
                {i === v.active ? <Spinner /> : <i aria-hidden="true" />}
                <span>{text}</span>
                {i === 2 && i <= v.active && hash ? <TxHash hash={hash} chain="stellar" /> : null}
              </li>
            ))}
          </ol>
          {slow && <p className="wz-hint">Didn&apos;t see it? Open {wallet} from your browser toolbar.</p>}
        </>
      )}

      {v.kind === "cancelled" && (
        <Notice
          tone="neutral"
          actions={
            <button type="button" className="wz-btn wz-btn-gold" onClick={d.register} disabled={Boolean(blocked)}>
              Sign again
            </button>
          }
        >
          You declined in {wallet}. Your BTC is still safe in the lock.
        </Notice>
      )}

      {v.kind === "attention" && (
        <Notice
          tone={v.failed ? "warning" : "info"}
          label={v.failed ? "Last step failed" : undefined}
          actions={
            <button type="button" className="wz-btn wz-btn-gold" onClick={d.finish} disabled={Boolean(blocked)}>
              Finish deposit
            </button>
          }
        >
          {v.failed
            ? "Your deposit is recorded on Stellar, but the last step failed. Your BTC is still locked and safe."
            : "Your deposit is recorded on Stellar. One more step adds your loan."}
          {hash ? (
            <>
              {" "}
              <TxHash hash={hash} chain="stellar" />
            </>
          ) : null}
        </Notice>
      )}

      {v.kind === "timed_out" && (
        <Notice
          tone="warning"
          label="Not confirmed yet"
          actions={
            <button type="button" className="wz-btn wz-btn-line" onClick={d.recheck}>
              Check again
            </button>
          }
        >
          Your transaction was sent but isn&apos;t confirmed yet. It may still go through. Don&apos;t send it again.
          {hash ? (
            <>
              {" "}
              <TxHash hash={hash} chain="stellar" />
            </>
          ) : null}
        </Notice>
      )}

      {v.kind === "failed" && (
        <ErrorBox
          error={v.error}
          context={{ flow: "deposit" }}
          hash={hash}
          actions={
            <button type="button" className="wz-btn wz-btn-gold" onClick={d.register} disabled={Boolean(blocked)}>
              Try again
            </button>
          }
        />
      )}
    </div>
  );
}

// ── Done ─────────────────────────────────────────────────────────────────

export function DoneStep({ m, heading }: { m: JourneyModel; heading: RefObject<HTMLHeadingElement | null> }) {
  const sats = m.done.sats ?? m.sats;
  const btc = sats ? formatBtc(sats) : null;
  const max = sats && m.priceStroops ? formatUsdc(maxBorrowStroops(sats, m.priceStroops)) : null;

  useEffect(() => {
    heading.current?.focus();
  }, [heading]);

  return (
    <div className="wz-stack wz-done">
      <span className="wz-done-mark" aria-hidden="true" />
      <h1 className="wz-h2" ref={heading} tabIndex={-1}>
        {btc ? (
          <>
            <span className="mono">{btc}</span> BTC locked
          </>
        ) : (
          "Your BTC is locked"
        )}
      </h1>
      <p>
        Your loan is ready.
        {max ? (
          <>
            {" "}
            You can borrow up to <span className="mono">{max}</span> USDC.
          </>
        ) : null}
      </p>
      <p className="wz-sr" role="status">
        {`${btc ? `${btc} BTC locked. ` : ""}Your loan is ready.${max ? ` You can borrow up to ${max} USDC.` : ""}`}
      </p>
      <div className="wz-actions">
        <Link href="/" className="wz-btn wz-btn-gold">
          Borrow now
        </Link>
        <button type="button" className="wz-btn wz-btn-line" onClick={m.done.reset}>
          Make another deposit
        </button>
      </div>
    </div>
  );
}
