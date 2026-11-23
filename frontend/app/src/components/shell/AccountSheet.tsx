"use client";

import Link from "next/link";
import { useState } from "react";
import { BTC_NETWORK_LABEL, config, LENDING_ENABLED } from "@/config";
import { networkName } from "@/lib/wallet/precheck";
import { formatBtc, shortAddress } from "@/lib/borrow/journey";
import { btcAddressUrl, stellarAccountUrl } from "@/lib/explorer";
import { BTC_FAUCETS, DOCS_URL, GITHUB_ISSUES_URL, GITHUB_SECURITY_URL } from "@/lib/links";
import { CopyButton, ErrorBox, ExternalLink, Notice } from "@/components/ui";
import type { PollarLogin } from "@/lib/wallet/WalletProvider";
import { TestKeyPanel } from "@/components/onboarding/TestKeyPanel";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { useShellAccount, type ShellAccount } from "./account";
import * as ui from "@/components/ui/styles";

type Chain = "stellar" | "bitcoin";

const section = "flex flex-col gap-[10px] py-5 [*+&]:border-t [*+&]:border-line";
const links =
  "flex flex-col gap-3 py-5 [*+&]:border-t [*+&]:border-line text-[14px] [&_a]:self-start [&_a]:text-body [&_a]:underline [&_a]:decoration-line-strong [&_a]:underline-offset-4 [&_a]:hover:text-heading [&_a]:hover:decoration-accent pointer-coarse:[&_a]:inline-flex pointer-coarse:[&_a]:items-center pointer-coarse:[&_a]:min-h-11";
const heading = "flex items-center gap-2 text-[15px] font-semibold text-heading";
const facts = "grid gap-1.5 m-0 text-[14px] [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&_dt]:text-muted [&_dd]:m-0 [&_dd]:text-heading";
const STELLAR = networkName(config.networkPassphrase);

function Address({ value }: { value: string }) {
  return (
    <p className="mono text-[14px] text-heading" aria-label={value}>
      {shortAddress(value, 8, 8)}
    </p>
  );
}

function Disconnect({ chain, a }: { chain: Chain; a: ShellAccount }) {
  const [confirming, setConfirming] = useState(false);
  const name = chain === "stellar" ? "Stellar" : "Bitcoin";
  const go = () => (chain === "stellar" ? a.stellar.disconnect() : a.bitcoin.disconnect());
  if (confirming) {
    return (
      <Notice
        tone="warning"
        label="Transaction in progress"
        actions={
          <>
            <button type="button" className={ui.btn("line", "sm")} onClick={go}>
              Disconnect
            </button>
            <button type="button" className={ui.btn("gold", "sm")} onClick={() => setConfirming(false)}>
              Stay connected
            </button>
          </>
        }
      >
        <p>
          Disconnect {name} wallet? A transaction is still in progress. It will keep going on chain, and you can check it
          here when you reconnect.
        </p>
      </Notice>
    );
  }
  return (
    <button type="button" className={ui.btn("line", "sm")} onClick={() => (a.busy ? setConfirming(true) : go())}>
      Disconnect
    </button>
  );
}

function StellarChecks({ a }: { a: ShellAccount }) {
  const s = a.stellar;
  if (s.wrongNetwork) {
    return (
      <Notice tone="warning" label="Wrong network">
        <p>
          Your wallet is on {s.wrongNetwork}. Writz runs on {STELLAR}. Switch network in {s.walletName}.
        </p>
      </Notice>
    );
  }
  if (s.feesSponsored && s.funding.kind === "ok" && s.funding.value.kind === "unfunded") {
    return <p className={ui.hint}>Your account is being created on Stellar. This takes a few seconds.</p>;
  }
  if (s.funding.kind === "ok" && s.funding.value.kind === "unfunded") {
    // Friendbot only exists on testnet; a mainnet account is funded with real XLM.
    if (config.target === "mainnet") {
      return (
        <Notice tone="warning" label="Account not funded">
          <p>This account has no XLM yet, so it can&apos;t pay network fees. Send XLM to it from an exchange or another wallet first.</p>
        </Notice>
      );
    }
    return (
      <Notice
        tone="warning"
        label="Account not funded"
        actions={
          <button type="button" className={ui.btn("line", "sm")} disabled={s.fundBusy} onClick={s.fund}>
            {s.fundBusy ? "Funding..." : "Fund with Friendbot"}
          </button>
        }
      >
        <p>This account has no test XLM yet, so it can&apos;t pay network fees.</p>
      </Notice>
    );
  }
  if (s.funding.kind === "ok" && s.funding.value.kind === "low" && !s.feesSponsored) {
    return (
      <Notice tone="warning" label="Low XLM">
        <p>Only {s.funding.value.xlm} XLM left. Keep at least 2 XLM for fees.</p>
      </Notice>
    );
  }
  return null;
}

const POLLAR_WORKING: Partial<Record<string, string>> = {
  creating_session: "Starting sign-in...",
  opening_oauth: "Finish signing in in the popup",
  sending_email: "Sending your code...",
  verifying_email_code: "Checking your code...",
  authenticating: "Signing you in...",
};

function PollarSignIn({ pollar }: { pollar: PollarLogin }) {
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const auth = pollar.session.auth;
  const working = POLLAR_WORKING[auth.step];

  if (auth.step === "authenticated") {
    return <p className={ui.hint}>Creating your Stellar account...</p>;
  }

  if (auth.step === "entering_code") {
    return (
      <form
        className={ui.stack}
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          pollar.verifyCode(code.trim());
        }}
      >
        <label htmlFor="sh-code" className={ui.label}>
          Code
        </label>
        <div className={ui.field("sm")}>
          <input
            id="sh-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="go"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </div>
        <p className={ui.hint}>We sent a code to {auth.email}.</p>
        <div className={ui.actions}>
          <button type="submit" className={ui.btn("gold", "sm")} disabled={!code.trim()}>
            Verify
          </button>
          <button type="button" className={ui.btn("line", "sm")} onClick={pollar.cancel}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (working) {
    return (
      <div className={ui.actions}>
        <p className={ui.hint}>{working}</p>
        <button type="button" className={ui.btn("line", "sm")} onClick={pollar.cancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (email !== null) {
    return (
      <form
        className={ui.stack}
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          setCode("");
          pollar.loginWithEmail(email.trim());
        }}
      >
        <label htmlFor="sh-email" className={ui.label}>
          Email
        </label>
        <div className={ui.field("sm")}>
          <input
            id="sh-email"
            type="email"
            autoComplete="email"
            enterKeyHint="send"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        <div className={ui.actions}>
          <button type="submit" className={ui.btn("gold", "sm")} disabled={!email.includes("@")}>
            Send code
          </button>
          <button type="button" className={ui.btn("line", "sm")} onClick={() => setEmail(null)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <p className={ui.hint}>
        No wallet? Sign in to get a test account with fees paid and free test BTC. Pollar holds the Stellar key and your Signet test key
        stays in this browser, so use it for testing only.
      </p>
      {auth.step === "error" ? <p className={ui.error}>{auth.message}</p> : null}
      <div className={ui.actions}>
        <button type="button" className={ui.btn("line", "sm")} onClick={() => pollar.login("google")}>
          Google
        </button>
        <button type="button" className={ui.btn("line", "sm")} onClick={() => pollar.login("github")}>
          GitHub
        </button>
        <button type="button" className={ui.btn("line", "sm")} onClick={() => setEmail("")}>
          Email
        </button>
      </div>
    </>
  );
}

export function AccountSheetBody() {
  const a = useShellAccount();
  const s = a.stellar;
  const b = a.bitcoin;
  const btcWallet = useBitcoinWallet();
  const testKey = !a.mock && btcWallet.kind === "embedded";
  const usdc = s.usdcAdded.kind === "checking" ? "Checking..." : s.usdcAdded.kind === "failed" ? "Couldn't check" : s.usdcAdded.value ? "Yes" : "Not yet";

  return (
    <div className="flex flex-col">
      <section className={section} aria-labelledby="sh-stellar">
        <h3 id="sh-stellar" className={heading}>
          <i className={ui.dot} data-on={Boolean(s.address)} aria-hidden="true" />
          Stellar wallet
        </h3>
        <p className={ui.hint}>Receives your USDC and signs loan actions.</p>
        {s.address ? (
          <>
            <Address value={s.address} />
            <StellarChecks a={a} />
            <dl className={facts}>
              <div>
                <dt>USDC added</dt>
                <dd>{usdc}</dd>
              </div>
            </dl>
            <div className={ui.actions}>
              <CopyButton value={s.address} />
              <ExternalLink href={stellarAccountUrl(s.address)} className={ui.btn("line", "sm")}>
                View on Stellar Expert
              </ExternalLink>
              <Disconnect chain="stellar" a={a} />
            </div>
          </>
        ) : (
          <div className={ui.actions}>
            <button type="button" className={ui.btn("gold", "sm")} disabled={s.connecting} onClick={s.connect}>
              {s.connecting ? "Confirm in your wallet" : "Connect Stellar wallet"}
            </button>
          </div>
        )}
        {!s.address && s.pollar ? <PollarSignIn pollar={s.pollar} /> : null}
      </section>

      <section className={section} aria-labelledby="sh-bitcoin">
        <h3 id="sh-bitcoin" className={heading}>
          <i className={ui.dot} data-on={Boolean(b.address)} aria-hidden="true" />
          {testKey ? "Signet test key" : "Bitcoin wallet"}
        </h3>
        <p className={ui.hint}>Holds the BTC you lock. Its key builds your lock address.</p>
        {b.address ? (
          <>
            <Address value={b.address} />
            <dl className={facts}>
              <div>
                <dt>Balance</dt>
                <dd className="mono">
                  {b.balance.kind === "ok" ? `${formatBtc(b.balance.value)} BTC` : b.balance.kind === "failed" ? "Couldn't check" : "Checking..."}
                </dd>
              </div>
            </dl>
            <div className={ui.actions}>
              <CopyButton value={b.address} />
              <ExternalLink href={btcAddressUrl(b.address)} className={ui.btn("line", "sm")}>
                View on mempool
              </ExternalLink>
              {testKey ? null : <Disconnect chain="bitcoin" a={a} />}
            </div>
            {!a.mock ? <TestKeyPanel /> : null}
          </>
        ) : (
          <div className={ui.actions}>
            <button type="button" className={ui.btn("line", "sm")} disabled={b.connecting} onClick={b.connect}>
              {b.connecting ? "Confirm in Xverse" : "Connect Xverse"}
            </button>
          </div>
        )}
      </section>

      {s.address ? (
        <section className={section} aria-labelledby="sh-loans">
          <h3 id="sh-loans" className={heading}>
            Your loans
          </h3>
          {a.loans.state === "failed" ? (
            <ErrorBox
              error={a.loans.error}
              label="Loans not loaded"
              actions={
                <button type="button" className={ui.btn("line", "sm")} onClick={a.loans.retry}>
                  Try again
                </button>
              }
            />
          ) : (
            <p className={ui.hint}>
              {a.loans.state === "finding"
                ? "Finding your loans..."
                : `Found on Stellar for this wallet: ${a.loanStatuses.length} ${a.loanStatuses.length === 1 ? "loan" : "loans"}.`}
            </p>
          )}
          {a.positions.length > 0 ? (
            <>
              <div className={ui.actions}>
                <button type="button" className={ui.btn("line", "sm")} onClick={a.downloadBackup}>
                  Download loan backup
                </button>
              </div>
              <p className={ui.hint}>
                Your loans are on Stellar and load on any device with this wallet. The backup keeps each deposit&apos;s Bitcoin transaction ID for
                reclaiming without Writz.
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      <nav className={ui.cx(links, "lg:hidden!")} aria-label="Other pages">
        <Link href="/protocol">Protocol</Link>
        <ExternalLink href={DOCS_URL} className="">
          Docs
        </ExternalLink>
        {LENDING_ENABLED ? <Link href="/help/reclaim">How to reclaim</Link> : null}
      </nav>

      <section className={links} aria-labelledby="sh-help">
        <h3 id="sh-help" className={heading}>
          Help
        </h3>
        <ExternalLink href={GITHUB_ISSUES_URL} className="">
          Report a problem on GitHub
        </ExternalLink>
        <ExternalLink href={GITHUB_SECURITY_URL} className="">
          Report a security issue
        </ExternalLink>
      </section>

      {config.target !== "mainnet" ? (
        <section className={links} aria-labelledby="sh-faucets">
          <h3 id="sh-faucets" className={heading}>
            Testnet faucets
          </h3>
          {BTC_FAUCETS.map((f) => (
            <ExternalLink key={f.href} href={f.href} className="">
              Test BTC on {BTC_NETWORK_LABEL}: {f.label}
            </ExternalLink>
          ))}
          {s.address ? (
            <button
              type="button"
              className="self-start p-0 border-none bg-transparent cursor-pointer text-body underline decoration-line-strong underline-offset-4 hover:text-heading hover:decoration-accent pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:min-h-11"
              disabled={s.fundBusy}
              onClick={s.fund}
            >
              Test XLM from Friendbot
            </button>
          ) : (
            <ExternalLink href="https://lab.stellar.org/account/fund" className="">
              Test XLM from Friendbot
            </ExternalLink>
          )}
          {config.earn.faucetUrl ? (
            <ExternalLink href={config.earn.faucetUrl} className="">
              Blend test USDC
            </ExternalLink>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
