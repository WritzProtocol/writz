"use client";

import Link from "next/link";
import { useEffect } from "react";
import { config } from "@/config";
import { formatBtc } from "@/lib/borrow/journey";
import { setDraftAmount } from "@/lib/borrow/draft";
import { loanHref } from "@/lib/loan/model";
import { useGuide } from "./useGuide";
import { guideLoan, guideProgress, type GuideLoan, type GuideStepId } from "@/lib/onboarding/guide";
import { satsToBtcInput, suggestDepositSats } from "@/lib/onboarding/defaults";
import type { ClaimState } from "@/lib/onboarding/autoClaim";
import { CopyButton, ExternalLink, Spinner } from "@/components/ui";
import { useShellAccount } from "@/components/shell/account";

/** The loan's state as the guide reads it: the derived status first, the local hint otherwise. */
function guideStatus(kind: string, local: GuideLoan["status"]): GuideLoan["status"] {
  if (kind === "released" || kind === "releasing") return "released";
  if (kind === "repaid_locked") return "closed";
  if (kind === "liquidated") return "liquidated";
  return local;
}

const TITLES: Record<GuideStepId, string> = {
  fund: "Get test BTC",
  deposit: "Lock BTC",
  borrow: "Borrow USDC",
  repay: "Repay",
  release: "Release your BTC",
};

function FundDetail({ claim, balance, address, retry }: { claim: ClaimState; balance: bigint | null; address: string | null; retry(): void }) {
  switch (claim.kind) {
    case "idle":
    case "checking":
      return (
        <p className="wz-status" aria-live="polite">
          <Spinner />
          <span>Checking your test key</span>
        </p>
      );
    case "claiming":
      return (
        <p className="wz-status" aria-live="polite">
          <Spinner />
          <span>Sending you test BTC</span>
        </p>
      );
    case "sent":
      return (
        <p>
          <span className="mono">{claim.amountSats.toLocaleString("en-US")}</span> sats sent. You can lock them now; Bitcoin confirms the
          payment in about 10 minutes. <ExternalLink href={claim.explorerUrl}>View on mempool</ExternalLink>
        </p>
      );
    case "confirmed":
      return (
        <p>
          <span className="mono">{claim.amountSats.toLocaleString("en-US")}</span> sats received.{" "}
          <ExternalLink href={claim.explorerUrl}>View on mempool</ExternalLink>
        </p>
      );
    case "funded":
      return (
        <p>
          Your test key holds <span className="mono">{formatBtc(balance ?? BigInt(claim.sats))}</span> BTC.
        </p>
      );
    case "failed": {
      const f = claim.failure;
      return (
        <div className="gs-fail">
          <p>
            <b>{f.title}.</b> {f.message}
          </p>
          <div className="wz-actions">
            {f.retryable ? (
              <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={retry}>
                Try again
              </button>
            ) : null}
            {f.publicFaucets.map((href) => (
              <ExternalLink key={href} href={href} className="wz-btn wz-btn-text">
                {new URL(href).host}
              </ExternalLink>
            ))}
          </div>
          {address ? (
            <p className="wz-hint">
              Your test key&apos;s address: <span className="mono wz-break">{address}</span> <CopyButton value={address} />
            </p>
          ) : null}
        </div>
      );
    }
  }
}

/**
 * Home's guide for a social sign-in: five steps from free test BTC to the
 * BTC coming back, each opening the existing screen with a sensible amount.
 */
export function GetStarted() {
  const o = useGuide();
  const a = useShellAccount();
  const report = o.report;

  const newest = guideLoan(a.loanStatuses);
  const loan: GuideLoan | null = newest
    ? {
        index: newest.position.index,
        txid: newest.position.txid,
        status: guideStatus(newest.derived.status.kind, newest.position.status),
        debtStroops: newest.derived.onChain?.debtStroops ?? BigInt(newest.position.debtStroops),
      }
    : null;
  const balance = a.bitcoin.balance.kind === "ok" ? a.bitcoin.balance.value : null;
  const progress = guideProgress({
    claim: o.claim,
    balanceSats: balance,
    depositPending: Boolean(a.pendingDeposit),
    loan,
    milestones: o.milestones,
  });

  // What the chain shows is reported too: a step done on another device, or one whose report failed.
  const loanTxid = loan?.txid ?? null;
  const onChainDebt = loan ? loan.debtStroops > 0n : false;
  const released = loan?.status === "released";
  useEffect(() => {
    if (!o.guided || !loanTxid) return;
    report("deposit", loanTxid);
    if (onChainDebt) report("borrow", loanTxid);
    if (released) report("release", loanTxid);
  }, [o.guided, loanTxid, onChainDebt, released, report]);

  if (!o.guided) return null;

  const deposit = balance !== null ? suggestDepositSats(balance, config.bitcoin.minDepositSats) : null;
  const allDone = progress.current === null;

  const action = (id: GuideStepId) => {
    if (progress.state(id) !== "now") return null;
    switch (id) {
      case "fund":
        return null;
      case "deposit":
        return a.pendingDeposit ? (
          <Link href="/borrow/new" className="wz-btn wz-btn-gold">
            Open your deposit
          </Link>
        ) : (
          <Link
            href="/borrow/new"
            className="wz-btn wz-btn-gold"
            onClick={() => {
              if (deposit !== null) setDraftAmount(satsToBtcInput(deposit));
            }}
          >
            {deposit !== null ? `Lock ${formatBtc(deposit)} BTC` : "Lock BTC"}
          </Link>
        );
      default:
        return loan ? (
          <Link href={loanHref(loan.index, id === "borrow" ? "borrow" : id === "repay" ? "repay" : "release")} className="wz-btn wz-btn-gold">
            {TITLES[id]}
          </Link>
        ) : null;
    }
  };

  const detail = (id: GuideStepId) => {
    if (id === "fund") {
      return progress.state("fund") === "done" && o.claim.kind !== "sent" && o.claim.kind !== "confirmed" ? null : (
        <FundDetail claim={o.claim} balance={balance} address={a.bitcoin.address} retry={o.retryClaim} />
      );
    }
    if (progress.state(id) !== "now") return null;
    switch (id) {
      case "deposit":
        return a.pendingDeposit ? (
          <p>Bitcoin is confirming your deposit. You can leave and come back.</p>
        ) : (
          <p>It goes to a Bitcoin script that only your key and Writz together can move. Fees on Stellar are paid for you.</p>
        );
      case "borrow":
        return <p>Borrow a small amount of test USDC. The guide suggests a quarter of what you could, far from liquidation.</p>;
      case "repay":
        return <p>Repay it all in one go. If interest left you a few cents short, swap a little test XLM first.</p>;
      case "release":
        return <p>Writz co-signs and your BTC goes back to your test key.</p>;
    }
  };

  return (
    <section className="hm-card gs" aria-labelledby="gs-title">
      <div className="gs-head">
        <h2 id="gs-title" className="hm-h2">
          {allDone ? "You did the whole loop" : "Your first loan, in five steps"}
        </h2>
        <p className="wz-hint">
          {allDone
            ? "You locked Bitcoin, borrowed dollars, repaid and got your BTC back. Start another loan any time."
            : "Test funds only. About 15 minutes, mostly waiting for one Bitcoin block."}
        </p>
      </div>
      <ol className="gs-steps">
        {(["fund", "deposit", "borrow", "repay", "release"] as const).map((id, i) => {
          const state = progress.state(id);
          return (
            <li key={id} data-state={state} aria-current={state === "now" ? "step" : undefined}>
              <span className="gs-n mono" aria-hidden="true">
                {i + 1}
              </span>
              <div className="gs-body">
                <p className="gs-title">
                  {TITLES[id]}
                  {state === "done" ? <span className="wz-sr"> (done)</span> : null}
                </p>
                {detail(id)}
                {action(id) ? <div className="wz-actions">{action(id)}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
