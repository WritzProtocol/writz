"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
import { Notice } from "@/components/ui";
import { DepositProof } from "@/components/borrow/DepositProof";
import { ReceiveSteps, useReceive } from "./receive";
import { LoanTimeline } from "./Timeline";
import { Enter } from "@/components/ui/entrance";
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

function Heading({ n, badge, sub }: { n: number; badge?: ReactNode; sub?: ReactNode }) {
  return (
    <Enter as="header" name="head" className="ln-head">
      <div className="ln-title">
        <HeadingTitle n={n} />
        {badge}
      </div>
      {sub ? <p className="ln-sub">{sub}</p> : null}
    </Enter>
  );
}

function Empty({ n, title, body, action }: { n: number; title?: string; body: ReactNode; action: ReactNode }) {
  return (
    <div className="ln-col">
      <Heading n={n} />
      <Enter as="section" name="empty" kind="open" className="ln-empty wz-cut-sm">
        {title ? <h2 className="wz-h2">{title}</h2> : null}
        <div>{body}</div>
        {action}
      </Enter>
    </div>
  );
}

/** Loan detail in the Panel layout: header, risk block beside the numbers, one action panel at a time. */
export function LoanView({ m }: { m: LoanModel }) {
  const { n, position, status: derived } = m;
  const status = derived.status;
  const [picked, setPicked] = useState<LoanTab | null>(null);
  const [focusTab, setFocusTab] = useState<LoanTab | null>(null);
  const [preview, setPreview] = useState<bigint | null>(null);
  const tabRefs = useRef<Record<LoanTab, HTMLButtonElement | null>>({ borrow: null, repay: null, release: null });
  const receive = useReceive(m, m.position);

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

  if (m.access === "finding")
    return (
      <Empty
        n={n}
        body={<p>Looking up the loans this wallet holds.</p>}
        action={
          <button type="button" className="wz-btn wz-btn-gold" disabled>
            Finding your loans...
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
  const height = derived.timelock?.height ?? position.timelockHeight ?? null;
  const blocksLeft = derived.timelock?.blocksLeft ?? null;
  const exit = blocksLeft !== null ? blockDate(blocksLeft, m.now) : null;
  const elapsed = Math.max(0, m.now - position.createdAt);
  const progress = derived.reclaimable ? 1 : blocksLeft !== null ? elapsed / (elapsed + blocksLeft * 600_000) : null;
  const checking = status.kind === "checking";
  const liq = liquidationPriceFor(collateral, debt);
  const released = status.kind === "released" || status.kind === "releasing";
  // A closed loan has nothing left to reclaim; don't point a liquidated borrower at the timelock.
  const closed = released || status.kind === "liquidated";
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

  const risk = showsRisk(status);
  const hasActions = (isOpen(status) || checking) && !isClosed(status);
  const notes = [
    status.kind === "repaid_locked" && status.missingBtcDetails ? <MissingDetails key="missing" m={m} height={height} /> : null,
    derived.reclaimable ? (
      <Notice key="reclaim" tone="info" label="Reclaim available">
        <p>You can reclaim this BTC without Writz.{status.kind === "repaid_locked" ? " You can still release it below." : ""}</p>
      </Notice>
    ) : null,
    toSafe !== null && toSafe > 0n ? (
      <Notice key="safe" tone={status.kind === "liquidatable" ? "danger" : "warning"} label={status.kind === "liquidatable" ? "Can be liquidated now" : "Close to liquidation"}>
        <p>
          Repay <span className="mono">{formatUsdc(toSafe)}</span> USDC to get back to 150%.
        </p>
      </Notice>
    ) : null,
    m.catchingUp && !checking ? (
      <Notice key="catching" tone="info" label="Waiting for Writz">
        <p>Your loan is repaid. Writz is co-signing the release of your BTC. It is usually ready within a minute. Your BTC is safe.</p>
      </Notice>
    ) : null,
  ].filter(Boolean);
  const hasNums = risk || status.kind === "liquidated";
  const rows = [hasNums ? "risk nums" : "risk side", notes.length > 0 ? (hasNums ? "notes notes" : "notes side") : null, hasActions ? "acts side" : hasNums ? "side ." : null].filter(
    (r): r is string => r !== null,
  );
  const sideTop = !hasNums;
  const grid = {
    ["--ln-areas" as string]: rows.map((r) => `"${r}"`).join(" "),
    ["--ln-rows" as string]: sideTop ? `${"auto ".repeat(rows.length - 1)}1fr` : "none",
  };

  return (
    <div className="ln-col">
      <Heading
        n={n}
        badge={<StatusBadge status={status} />}
        sub={
          <>
            Opened {shortDate(position.createdAt)}. <span className="mono">{formatBtc(collateral)}</span> BTC {released ? "deposited" : "locked"}.
          </>
        }
      />

      <div className="ln-grid" data-risk={risk} data-side={sideTop ? "top" : undefined} style={grid}>
        {risk ? (
          <Enter as="section" name="risk" kind="open" className="ln-risk wz-cut" aria-label="Risk">
            <HealthText ratioBp={ratioBp} health={checking ? null : health} />
            <HealthMeter ratioBp={ratioBp} health={checking ? null : health} preview={preview} />
            {checking ? (
              <p className="ln-liq">Checking...</p>
            ) : m.price.kind === "failed" ? (
              <div className="wz-actions ln-liq">
                <p>BTC price unavailable. Try again in a minute.</p>
                <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={m.recheckPrice}>
                  Try again
                </button>
              </div>
            ) : debt > 0n && liq !== null ? (
              <p className="ln-liq">
                Liquidated if BTC falls below <b className="mono">{formatUsd(liq)}</b>. BTC now{" "}
                <span className="mono">{price !== null ? formatUsd(price) : "Checking..."}</span> (oracle price).
              </p>
            ) : (
              <p className="ln-liq">
                No debt yet, so nothing can be liquidated. BTC now{" "}
                <span className="mono">{price !== null ? formatUsd(price) : "Checking..."}</span> (oracle price).
              </p>
            )}
          </Enter>
        ) : (
          <Enter name="closed" step={2} className="ln-closed">
            <ClosedNotice status={status} position={position} />
          </Enter>
        )}

        {risk ? (
          <Enter as="dl" name="nums" step={3} className="ln-nums">
            <div>
              <dt>Collateral</dt>
              <dd>
                <span className="mono">{formatBtc(collateral)} BTC</span>
                {price !== null && !checking ? (
                  <small>
                    at <span className="mono">{formatUsd(price)}</span> per BTC
                  </small>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>You owe</dt>
              <dd className="mono">{formatUsdc(debt)} USDC</dd>
            </div>
            <div>
              <dt>Available to borrow</dt>
              <dd className="mono">
                {checking || !available ? "Checking..." : `${formatUsdc(health === "healthy" || health === "none" ? available.stroops : 0n)} USDC`}
              </dd>
            </div>
          </Enter>
        ) : status.kind === "liquidated" ? (
          <Enter as="dl" name="nums" step={3} className="ln-nums">
            <div>
              <dt>Collateral</dt>
              <dd className="mono">{formatBtc(collateral)} BTC</dd>
            </div>
            <div>
              <dt>You owe</dt>
              <dd className="mono">0.00 USDC</dd>
            </div>
          </Enter>
        ) : null}

        {notes.length > 0 ? (
          <Enter name="notes" step={3} className="ln-notes">
            {notes}
          </Enter>
        ) : null}

        {hasActions && (
          <Enter as="section" name="actions" step={4} className="ln-actions" aria-label="Actions">
            <div
              className="wz-seg"
              role="tablist"
              aria-label="Choose an action"
              style={{ ["--seg-n" as string]: LOAN_TABS.length, ["--seg-i" as string]: tab ? LOAN_TABS.indexOf(tab) : 0 }}
            >
              {tab ? <span className="wz-seg-ind" aria-hidden="true" /> : null}
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
              <Notice tone="positive" label="Done" className="wz-enter">
                <p>
                  {m.action === "repay" && debt === 0n
                    ? "Loan repaid. Your BTC is still locked. Release it below."
                    : m.action === "repay"
                      ? `Repaid${m.lastAmount !== null ? ` ${formatUsdc(m.lastAmount)} USDC` : ""}.`
                      : `Borrowed${m.lastAmount !== null ? ` ${formatUsdc(m.lastAmount)} USDC` : ""}. It's in your Stellar wallet.`}
                </p>
              </Notice>
            )}
            {receive.leg && <ReceiveSteps r={receive} walletName={m.stellar.walletName} />}
            {!checking && tab && tabs[tab].enabled && (
              <div
                className="ln-panel ln-act-panel wz-enter"
                id="loan-panel"
                role="tabpanel"
                aria-labelledby={`loan-tab-${tab}`}
                key={`${tab}:${position.id}`}
              >
                {tab === "borrow" && <BorrowPanel m={m} r={receive} position={position} available={available} price={price} onPreview={setPreview} />}
                {tab === "repay" && <RepayPanel m={m} position={position} price={price} initial={toSafe} onPreview={setPreview} />}
                {tab === "release" && (
                  <ReleasePanel m={m} position={position} neverBorrowed={status.kind === "repaid_locked" && status.neverBorrowed} />
                )}
              </div>
            )}
          </Enter>
        )}

        <div className="ln-side">
          <DepositProof btcTxid={position.txid} stellarTxHash={position.stellarTxHash ?? null} verified />
          <LoanTimeline m={m} position={position} />
          {!closed && (
            <WayOut
              n={n}
              height={height}
              date={exit}
              reclaimable={derived.reclaimable}
              progress={progress}
              opened={shortDate(position.createdAt)}
            />
          )}
          <OnThisDevice items={m.activity} />
        </div>
      </div>
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

