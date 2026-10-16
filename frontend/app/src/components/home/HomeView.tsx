"use client";

import Link from "next/link";
import { config } from "@/config";
import { shortAddress } from "@/lib/borrow/journey";
import { homeHeadline, pickUrgent, sortLoans } from "@/lib/home/model";
import { DOCS_URL } from "@/lib/links";
import { networkName } from "@/lib/wallet/precheck";
import { useRefreshStatus } from "@/lib/status/provider";
import { ExternalLink, Notice } from "@/components/redesign/ui";
import { useShellAccount } from "@/components/shell/account";
import type { HomeData } from "./data";
import { EarnCard, HowALoanWorks, LendCard, LoanSkeleton, LoanSummaryCard, Preview, UrgentCard } from "./parts";

const STELLAR = networkName(config.networkPassphrase);

function GlobalNotices({ data }: { data: HomeData }) {
  const a = useShellAccount();
  const s = a.stellar;
  return (
    <>
      {s.wrongNetwork ? (
        <Notice tone="warning" label="Wrong network">
          <p>
            Your wallet is on {s.wrongNetwork}. Writz runs on {STELLAR}. Switch network in {s.walletName}.
          </p>
        </Notice>
      ) : null}
      {s.switchedFrom && s.address ? (
        <Notice tone="info" label="Wallet switched">
          <p>Switched to {shortAddress(s.address)}. Sign to find loans for this wallet.</p>
        </Notice>
      ) : null}
      {a.rpcUnreachable || data.price.kind === "failed" ? (
        <Notice
          tone="warning"
          label="Network"
          actions={
            <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={data.retry}>
              Try again
            </button>
          }
        >
          <p>Can&apos;t reach {STELLAR} right now. Your funds are not affected.</p>
        </Notice>
      ) : null}
      {a.relayerCatchingUp ? (
        <Notice tone="info" label="Catching up">
          <p>Writz is catching up with the chain. Your funds are safe. Try again in a minute.</p>
        </Notice>
      ) : null}
      {a.otherTabTx ? (
        <Notice tone="info" label="Another tab">
          <p>Waiting for your other transaction (in another tab).</p>
        </Notice>
      ) : null}
    </>
  );
}

export function HomeView({ data }: { data: HomeData }) {
  const a = useShellAccount();
  const refresh = useRefreshStatus();
  const { open, closed } = sortLoans(a.loanStatuses);
  const urgent = pickUrgent(a.loanStatuses, a.deposit);

  const earn = data.earn?.kind === "ok" && data.earn.value.balanceStroops > 0n ? data.earn.value : null;
  const supplied = data.lend?.kind === "ok" && data.lend.value > 0n ? data.lend.value : null;
  const hasLoans = a.loanStatuses.length > 0 || Boolean(a.deposit);
  const connected = Boolean(a.stellar.address);
  const unsigned = connected && (a.loans.state === "unsigned" || a.loans.state === "signing");
  const finding = connected && a.loans.state === "finding" && !hasLoans;
  const only = open.length === 1 ? open[0].derived.status : null;

  const headline = homeHeadline({
    urgent,
    openLoans: open.length,
    onlyLoan: only,
    lender: hasLoans ? null : earn ? "earn" : supplied ? "lend" : null,
    findingLoans: finding,
  });
  const urgentLoanId = urgent?.loan?.position.id ?? null;
  const isNew = !hasLoans && !finding && !earn && !supplied;
  const m = config.bitcoin.minConfirmations;
  const checkDeposit = () => {
    if (a.pendingDeposit) refresh({ position: null, pendingDeposit: a.pendingDeposit });
  };

  return (
    <div className="hm-col">
      <GlobalNotices data={data} />

      <header className="hm-head">
        <h1 className="hm-h1 hm-display">{headline}</h1>
        {isNew ? (
          <p className="hm-sub">
            Lock BTC on Bitcoin and borrow USDC on Stellar. Repay and your BTC comes back. No bridge, no custodian, no wrapped
            token. Test funds only.
          </p>
        ) : null}
      </header>

      {urgent ? (
        <UrgentCard u={urgent} price={data.price} m={m} onCheckAgain={checkDeposit} findLoans={a.loans.retry} />
      ) : null}

      {unsigned ? (
        <Notice
          tone="info"
          label="Find your loans"
          actions={
            <button type="button" className="wz-btn wz-btn-gold" disabled={a.loans.state === "signing"} onClick={a.loans.sign}>
              {a.loans.state === "signing" ? `Confirm in ${a.stellar.walletName}` : "Sign to find my loans"}
            </button>
          }
        >
          <p>Sign to find loans made with this wallet. Free, no transaction.</p>
        </Notice>
      ) : null}

      {finding ? (
        <section aria-labelledby="finding" className="hm-section">
          <h2 id="finding" className="hm-h2" aria-live="polite">
            Finding your loans...
          </h2>
          <div className="hm-loans">
            <LoanSkeleton />
          </div>
        </section>
      ) : null}

      {open.length > 0 ? (
        <section aria-label={open.length === 1 ? "Your loan" : "Your loans"} className="hm-loans" data-count={open.length}>
          {open.map((l) => (
            <LoanSummaryCard
              key={l.position.id}
              loan={l}
              price={data.price}
              findLoans={a.loans.retry}
              compact={open.length > 1}
              primary={urgentLoanId !== l.position.id}
            />
          ))}
        </section>
      ) : null}

      {closed.length > 0 ? (
        <details className="hm-closed">
          <summary>Closed loans ({closed.length})</summary>
          <div className="hm-loans" data-count={closed.length}>
            {closed.map((l) => (
              <LoanSummaryCard key={l.position.id} loan={l} price={data.price} findLoans={a.loans.retry} compact primary={false} />
            ))}
          </div>
        </details>
      ) : null}

      {earn || supplied ? (
        <div className="hm-grid">
          {earn ? <EarnCard earn={earn} /> : null}
          {supplied ? <LendCard supplied={supplied} /> : null}
        </div>
      ) : null}

      {!hasLoans && !finding ? (
        earn || supplied ? (
          <div className="wz-actions">
            <Link href="/borrow/new" className="wz-btn wz-btn-line">
              Start a loan
            </Link>
          </div>
        ) : (
          <Preview price={data.price} balance={a.bitcoin.address ? a.bitcoin.balance : null} tipHeight={data.tipHeight} now={data.now} />
        )
      ) : null}

      {!hasLoans ? <HowALoanWorks /> : null}

      <nav className="hm-foot" aria-label="More">
        <Link href="/protocol" className="wz-btn wz-btn-text">
          Protocol stats
        </Link>
        <Link href="/help/reclaim" className="wz-btn wz-btn-text">
          How to reclaim
        </Link>
        <ExternalLink href={DOCS_URL} className="wz-btn wz-btn-text">
          Docs
        </ExternalLink>
      </nav>
    </div>
  );
}
