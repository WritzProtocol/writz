"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { config } from "@/config";
import { formatBtc, formatUsd, formatUsdc } from "@/lib/borrow/journey";
import { isInFlight } from "@/lib/flow/engine";
import {
  LOAN_TABS,
  REASONS,
  availableToBorrow,
  blockDate,
  defaultTab,
  disabledReasons,
  healthOf,
  isClosed,
  isOpen,
  liquidationPriceFor,
  loanTabs,
  readValue,
  repayToSafeStroops,
  shortDate,
  showsRisk,
  type LoanTab,
} from "@/lib/loan/model";
import { Notice } from "@/components/redesign/ui";
import type { LoanModel } from "./model";
import {
  BorrowPanel,
  ClosedNotice,
  HealthMeter,
  HealthText,
  MissingDetails,
  OnThisDevice,
  ReleasePanel,
  RepayPanel,
  StatusBadge,
  WayOut,
} from "./parts";

const TAB_LABEL: Record<LoanTab, string> = { borrow: "Borrow more", repay: "Repay", release: "Release BTC" };


function Heading({ n }: { n: number }) {
  return (
    <header className="ln-head">
      <div>
        <HeadingTitle n={n} />
      </div>
    </header>
  );
}

function Empty({ n, title, body, action }: { n: number; title?: string; body: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="ln-col">
      <Heading n={n} />
      <section className="ln-empty">
        {title ? <h2 className="wz-h2">{title}</h2> : null}
        <div>{body}</div>
        {action}
      </section>
    </div>
  );
}

/** Loan detail in the Panel layout: header, risk block beside the numbers, one action panel at a time. */
export function LoanView({ m }: { m: LoanModel }) {
  const { n, position, status: derived } = m;
  const status = derived.status;
  const [picked, setPicked] = useState<LoanTab | null>(null);
  const [focusTab, setFocusTab] = useState<LoanTab | null>(null);
  const tabRefs = useRef<Record<LoanTab, HTMLButtonElement | null>>({ borrow: null, repay: null, release: null });

  if (m.access === "disconnected")
    return (
      <Empty
        n={n}
        body={<p>Connect your Stellar wallet to see this loan. It receives your USDC and signs loan actions.</p>}
        action={
          <button type="button" className="wz-btn wz-btn-gold" onClick={m.stellar.connect} disabled={m.stellar.connecting}>
            {m.stellar.connecting ? `Confirm in ${m.stellar.walletName}` : "Connect Stellar wallet"}
          </button>
        }
      />
    );

  if (m.access === "locked" || m.access === "finding")
    return (
      <Empty
        n={n}
        body={
          <p>
            Your wallet will ask you to sign a message. It is free and sends no transaction. It lets this app find loans made with this
            wallet.
          </p>
        }
        action={
          <button
            type="button"
            className="wz-btn wz-btn-gold"
            onClick={m.stellar.unlock}
            disabled={m.stellar.unlocking || m.access === "finding"}
          >
            {m.access === "finding" ? "Finding your loans..." : m.stellar.unlocking ? `Confirm in ${m.stellar.walletName}` : "Sign to find my loans"}
          </button>
        }
      />
    );

  if (!position)
    return (
      <Empty
        n={n}
        body={
          m.depositInProgress ? (
            <p>The deposit for Loan {n} is still on its way. Follow it from the deposit page.</p>
          ) : (
            <p>There is no Loan {n} on this device.</p>
          )
        }
        action={
          <Link href={m.depositInProgress ? "/borrow/new" : "/"} className="wz-btn wz-btn-gold">
            {m.depositInProgress ? "Go to your deposit" : "Go home"}
          </Link>
        }
      />
    );

  const collateral = BigInt(position.collateralSats);
  const debt = BigInt(position.debtStroops);
  const price = readValue(m.price);
  const pool = m.pool.kind === "ok" ? m.pool.value : null;
  const available = price !== null && m.pool.kind !== "checking" ? availableToBorrow(collateral, debt, price, pool) : null;
  const health = healthOf(status);
  const ratioBp = "ratioBp" in status ? status.ratioBp : null;
  const busy = m.action && isInFlight(m.flow) ? m.action : null;
  const tabs = loanTabs({
    status: derived,
    debtStroops: debt,
    price: m.price,
    available,
    busy,
    otherTx: m.otherTx,
    catchingUp: m.catchingUp,
  });
  const tab = busy ?? (picked && tabs[picked].enabled ? picked : defaultTab(tabs, status, m.requestedPanel, null));
  const reasons = disabledReasons(tabs);
  const shownReasons = m.catchingUp ? reasons.filter((r) => r !== REASONS.catchingUp) : reasons;
  const reasonId = (t: LoanTab) => {
    const s = tabs[t];
    return s.enabled ? undefined : `loan-reason-${reasons.indexOf(s.reason)}`;
  };
  const toSafe = price !== null && (status.kind === "at_risk" || status.kind === "liquidatable") ? repayToSafeStroops(collateral, debt, price) : null;
  const height = derived.timelock?.height ?? position.timelockHeight ?? config.bitcoin.timelockHeight;
  const blocksLeft = derived.timelock?.blocksLeft ?? null;
  const exit = blocksLeft !== null ? blockDate(blocksLeft, m.now) : null;
  const checking = status.kind === "checking";
  const liq = liquidationPriceFor(collateral, debt);
  const released = status.kind === "released" || status.kind === "releasing";
  const landedElsewhere = m.action && m.action !== "release" && m.flow.phase === "settled" && (m.action !== tab || !tabs[tab].enabled);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, t: LoanTab) => {
    const i = LOAN_TABS.indexOf(t);
    const next =
      e.key === "ArrowRight" ? LOAN_TABS[(i + 1) % 3] : e.key === "ArrowLeft" ? LOAN_TABS[(i + 2) % 3] : e.key === "Home" ? "borrow" : e.key === "End" ? "release" : null;
    if (!next) return;
    e.preventDefault();
    setFocusTab(next);
    tabRefs.current[next]?.focus();
  };
  const rover = focusTab ?? tab ?? "borrow";

  return (
    <div className="ln-col">
      <header className="ln-head">
        <div>
          <HeadingTitle n={n} />
          <p className="wz-muted">
            Opened {shortDate(position.createdAt)}. <span className="mono">{formatBtc(collateral)}</span> BTC{" "}
            {released ? "deposited" : "locked"}.
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      {showsRisk(status) ? (
        <section className="ln-risk" aria-label="Risk">
          <div className="ln-risk-main">
            <HealthText ratioBp={ratioBp} health={checking ? null : health} />
            <HealthMeter ratioBp={ratioBp} health={checking ? null : health} />
            {checking ? (
              <p className="wz-hint">Checking...</p>
            ) : m.price.kind === "failed" ? (
              <div className="wz-actions">
                <p className="wz-hint">BTC price unavailable. Try again in a minute.</p>
                <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={m.recheckPrice}>
                  Try again
                </button>
              </div>
            ) : debt > 0n && liq !== null ? (
              <p className="wz-hint">
                Liquidated if BTC falls below <b className="mono ln-em">{formatUsd(liq)}</b>. BTC now{" "}
                <span className="mono">{price !== null ? formatUsd(price) : "Checking..."}</span> (oracle price).
              </p>
            ) : (
              <p className="wz-hint">
                No debt yet, so nothing can be liquidated. BTC now{" "}
                <span className="mono">{price !== null ? formatUsd(price) : "Checking..."}</span> (oracle price).
              </p>
            )}
          </div>
          <dl className="ln-nums">
            <div className="wz-row">
              <dt>Collateral</dt>
              <dd>
                <span className="mono">{formatBtc(collateral)} BTC</span>
                {price !== null && !checking ? <small className="mono">{formatUsd((collateral * price) / 100_000_000n)}</small> : null}
              </dd>
            </div>
            <div className="wz-row">
              <dt>You owe</dt>
              <dd className="mono">{formatUsdc(debt)} USDC</dd>
            </div>
            <div className="wz-row">
              <dt>Available to borrow</dt>
              <dd className="mono">
                {checking || !available ? "Checking..." : `${formatUsdc(health === "healthy" || health === "none" ? available.stroops : 0n)} USDC`}
              </dd>
            </div>
          </dl>
        </section>
      ) : (
        <>
          <ClosedNotice status={status} position={position} />
          {status.kind === "liquidated" && (
            <dl className="wz-well">
              <div className="wz-row">
                <dt>Collateral</dt>
                <dd className="mono">{formatBtc(collateral)} BTC</dd>
              </div>
              <div className="wz-row">
                <dt>You owe</dt>
                <dd className="mono">0.00 USDC</dd>
              </div>
            </dl>
          )}
        </>
      )}

      {status.kind === "repaid_locked" && status.missingBtcDetails && <MissingDetails m={m} height={height} />}

      {derived.reclaimable && (
        <Notice tone="info" label="Reclaim available">
          <p>You can reclaim this BTC without Writz.{status.kind === "repaid_locked" ? " You can still release it below." : ""}</p>
        </Notice>
      )}

      {toSafe !== null && toSafe > 0n && (
        <Notice tone={status.kind === "liquidatable" ? "danger" : "warning"} label={status.kind === "liquidatable" ? "Can be liquidated now" : "Close to liquidation"}>
          <p>
            Repay <span className="mono">{formatUsdc(toSafe)}</span> USDC to get back to 150%.
          </p>
        </Notice>
      )}

      {m.catchingUp && !checking && (
        <Notice tone="info" label="Writz is catching up">
          <p>Writz is catching up with the chain. Your funds are safe. Try again in a minute.</p>
        </Notice>
      )}

      {(isOpen(status) || checking) && !isClosed(status) && (
        <section className="ln-actions" aria-label="Actions">
          <div className="ln-seg" role="tablist" aria-label="Choose an action">
            {LOAN_TABS.map((t) => (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[t] = el;
                }}
                id={`loan-tab-${t}`}
                type="button"
                role="tab"
                aria-selected={tab === t}
                aria-controls="loan-panel"
                aria-disabled={!tabs[t].enabled}
                aria-describedby={reasonId(t)}
                tabIndex={rover === t ? 0 : -1}
                title={tabs[t].enabled ? undefined : (tabs[t] as { reason: string }).reason}
                onClick={() => tabs[t].enabled && setPicked(t)}
                onKeyDown={(e) => onTabKey(e, t)}
                onFocus={() => setFocusTab(t)}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          {reasons.length > 0 && (
            <ul className="ln-reasons">
              {reasons.map((r, i) => (
                <li key={r} id={`loan-reason-${i}`} className={shownReasons.includes(r) ? undefined : "wz-sr"}>
                  {r}
                </li>
              ))}
            </ul>
          )}
          {landedElsewhere && (
            <Notice tone="positive" label="Done">
              <p>
                {m.action === "repay" && debt === 0n
                  ? "Loan repaid. Your BTC is still locked. Release it below."
                  : m.action === "repay"
                    ? `Repaid${m.lastAmount !== null ? ` ${formatUsdc(m.lastAmount)} USDC` : ""}.`
                    : `Borrowed${m.lastAmount !== null ? ` ${formatUsdc(m.lastAmount)} USDC` : ""}. It's in your Stellar wallet.`}
              </p>
            </Notice>
          )}
          {!checking && tab && tabs[tab].enabled && (
            <div className="ln-panel wz-enter" id="loan-panel" role="tabpanel" aria-labelledby={`loan-tab-${tab}`} key={`${tab}:${position.id}`}>
              {tab === "borrow" && <BorrowPanel m={m} position={position} available={available} price={price} />}
              {tab === "repay" && <RepayPanel m={m} position={position} price={price} initial={toSafe} />}
              {tab === "release" && (
                <ReleasePanel m={m} position={position} neverBorrowed={status.kind === "repaid_locked" && status.neverBorrowed} />
              )}
            </div>
          )}
        </section>
      )}

      {!released && <WayOut height={height} date={exit} reclaimable={derived.reclaimable} />}

      <OnThisDevice items={m.activity} />
    </div>
  );
}

function HeadingTitle({ n }: { n: number }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1}>
      Loan {n}
    </h1>
  );
}

