"use client";

import Link from "next/link";
import { useState } from "react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { networkName } from "@/lib/wallet/precheck";
import { formatBtc, shortAddress } from "@/lib/borrow/journey";
import { btcAddressUrl, stellarAccountUrl } from "@/lib/explorer";
import { BTC_FAUCETS, DOCS_URL, GITHUB_ISSUES_URL, GITHUB_SECURITY_URL, RECLAIM_DOCS_URL } from "@/lib/links";
import { ErrorBox, ExternalLink, Notice } from "@/components/redesign/ui";
import { useShellAccount, type ShellAccount } from "./account";

type Chain = "stellar" | "bitcoin";
const STELLAR = networkName(config.networkPassphrase);

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        className="wz-btn wz-btn-line wz-btn-sm"
        onClick={() =>
          void navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => {})
        }
      >
        {copied ? "Copied" : "Copy address"}
      </button>
      <span className="wz-sr" aria-live="polite">
        {copied ? "Address copied" : ""}
      </span>
    </>
  );
}

function Address({ value }: { value: string }) {
  return (
    <p className="mono sh-addr" aria-label={value}>
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
            <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={go}>
              Disconnect
            </button>
            <button type="button" className="wz-btn wz-btn-gold wz-btn-sm" onClick={() => setConfirming(false)}>
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
    <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={() => (a.busy ? setConfirming(true) : go())}>
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
  if (s.funding.kind === "ok" && s.funding.value.kind === "unfunded") {
    return (
      <Notice
        tone="warning"
        label="Account not funded"
        actions={
          <button type="button" className="wz-btn wz-btn-line wz-btn-sm" disabled={s.fundBusy} onClick={s.fund}>
            {s.fundBusy ? "Funding..." : "Fund with Friendbot"}
          </button>
        }
      >
        <p>This account has no test XLM yet, so it can&apos;t pay network fees.</p>
      </Notice>
    );
  }
  if (s.funding.kind === "ok" && s.funding.value.kind === "low") {
    return (
      <Notice tone="warning" label="Low XLM">
        <p>Only {s.funding.value.xlm} XLM left. Keep at least 2 XLM for fees.</p>
      </Notice>
    );
  }
  return null;
}

export function AccountSheetBody() {
  const a = useShellAccount();
  const s = a.stellar;
  const b = a.bitcoin;
  const usdc = s.usdcAdded.kind === "checking" ? "Checking..." : s.usdcAdded.kind === "failed" ? "Couldn't check" : s.usdcAdded.value ? "Yes" : "Not yet";

  return (
    <div className="sh-sections">
      <section className="sh-section" aria-labelledby="sh-stellar">
        <h3 id="sh-stellar" className="sh-h">
          <i className="wz-dot" data-on={Boolean(s.address)} aria-hidden="true" />
          Stellar wallet
        </h3>
        <p className="wz-hint">Receives your USDC and signs loan actions.</p>
        {s.address ? (
          <>
            <Address value={s.address} />
            <StellarChecks a={a} />
            <dl className="sh-facts">
              <div>
                <dt>USDC added</dt>
                <dd>{usdc}</dd>
              </div>
            </dl>
            <div className="wz-actions">
              <CopyButton value={s.address} />
              <ExternalLink href={stellarAccountUrl(s.address)} className="wz-btn wz-btn-line wz-btn-sm">
                View on Stellar Expert
              </ExternalLink>
              <Disconnect chain="stellar" a={a} />
            </div>
          </>
        ) : (
          <div className="wz-actions">
            <button type="button" className="wz-btn wz-btn-gold wz-btn-sm" disabled={s.connecting} onClick={s.connect}>
              {s.connecting ? "Confirm in your wallet" : "Connect Stellar wallet"}
            </button>
            {s.connectWithPrivy ? (
              <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={s.connectWithPrivy}>
                Email or social login
              </button>
            ) : null}
          </div>
        )}
      </section>

      <section className="sh-section" aria-labelledby="sh-bitcoin">
        <h3 id="sh-bitcoin" className="sh-h">
          <i className="wz-dot" data-on={Boolean(b.address)} aria-hidden="true" />
          Bitcoin wallet
        </h3>
        <p className="wz-hint">Holds the BTC you lock. Its key builds your lock address.</p>
        {b.address ? (
          <>
            <Address value={b.address} />
            <dl className="sh-facts">
              <div>
                <dt>Balance</dt>
                <dd className="mono">
                  {b.balance.kind === "ok" ? `${formatBtc(b.balance.value)} BTC` : b.balance.kind === "failed" ? "Couldn't check" : "Checking..."}
                </dd>
              </div>
            </dl>
            <div className="wz-actions">
              <CopyButton value={b.address} />
              <ExternalLink href={btcAddressUrl(b.address)} className="wz-btn wz-btn-line wz-btn-sm">
                View on mempool
              </ExternalLink>
              <Disconnect chain="bitcoin" a={a} />
            </div>
          </>
        ) : (
          <div className="wz-actions">
            <button type="button" className="wz-btn wz-btn-line wz-btn-sm" disabled={b.connecting} onClick={b.connect}>
              {b.connecting ? "Confirm in Xverse" : "Connect Xverse"}
            </button>
          </div>
        )}
      </section>

      {s.address ? (
        <section className="sh-section" aria-labelledby="sh-loans">
          <h3 id="sh-loans" className="sh-h">
            Your loans on this device
          </h3>
          {a.loans.state === "unsigned" || a.loans.state === "signing" ? (
            <>
              <p className="wz-hint">
                Your wallet will ask you to sign a message. It is free and sends no transaction. It lets this app find loans
                made with this wallet.
              </p>
              <div className="wz-actions">
                <button type="button" className="wz-btn wz-btn-gold wz-btn-sm" disabled={a.loans.state === "signing"} onClick={a.loans.sign}>
                  {a.loans.state === "signing" ? `Confirm in ${s.walletName}` : "Sign to find my loans"}
                </button>
              </div>
            </>
          ) : a.loans.state === "failed" ? (
            <ErrorBox
              error={a.loans.error}
              label="Loans not loaded"
              actions={
                <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={a.loans.retry}>
                  Try again
                </button>
              }
            />
          ) : (
            <p className="wz-hint">
              {a.loans.state === "finding"
                ? "Finding your loans..."
                : `Found with your Stellar wallet: ${a.loanStatuses.length} ${a.loanStatuses.length === 1 ? "loan" : "loans"}.`}
            </p>
          )}
          {a.positions.length > 0 ? (
            <>
              <div className="wz-actions">
                <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={a.downloadBackup}>
                  Download loan backup
                </button>
              </div>
              <p className="wz-hint">
                To release BTC from another device, that device needs this deposit&apos;s Bitcoin details. Keep this file.
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      <nav className="sh-section sh-links sh-compact" aria-label="Other pages">
        <Link href="/metrics">Protocol</Link>
        <ExternalLink href={DOCS_URL} className="">
          Docs
        </ExternalLink>
        <ExternalLink href={RECLAIM_DOCS_URL} className="">
          How to reclaim
        </ExternalLink>
      </nav>

      <section className="sh-section sh-links" aria-labelledby="sh-help">
        <h3 id="sh-help" className="sh-h">
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
        <section className="sh-section sh-links" aria-labelledby="sh-faucets">
          <h3 id="sh-faucets" className="sh-h">
            Testnet faucets
          </h3>
          {BTC_FAUCETS.map((f) => (
            <ExternalLink key={f.href} href={f.href} className="">
              Test BTC on {BTC_NETWORK_LABEL}: {f.label}
            </ExternalLink>
          ))}
          {s.address ? (
            <button type="button" className="sh-linkbtn" disabled={s.fundBusy} onClick={s.fund}>
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
