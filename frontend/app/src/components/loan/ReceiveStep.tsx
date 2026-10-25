"use client";

import { useState } from "react";
import { config } from "@/config";
import { formatUsdc, shortAddress } from "@/lib/borrow/journey";
import { stellarTxUrl } from "@/lib/explorer";
import type { FlowState } from "@/lib/flow/engine";
import { destinationTxUrl } from "@/lib/receive/cctp";
import { receivePhase, type ReceiveIntent, type ReceivePhase } from "@/lib/receive/intent";
import { minOut, type SwapResult } from "@/lib/receive/swap";
import { useReceive, useXlmQuote, type ChainLeg, type XlmQuote } from "@/lib/receive/useReceive";
import { ExternalLink, Notice } from "@/components/ui";
import { TxRunning } from "./parts";

const DEST = config.receive.cctp.destination.name;

export interface ReceiveStepProps {
  intent: Exclude<ReceiveIntent, { kind: "usdc" }>;
  /** USDC stroops the borrow just paid into the wallet. */
  amount: bigint;
  phase: ReceivePhase;
  flow: FlowState;
  quote: XlmQuote;
  swap: SwapResult | null;
  leg: ChainLeg;
  mintHash: string | null;
  walletName: string;
  onGo: () => void;
  onKeep: () => void;
}

const usdc = (s: bigint) => <span className="mono">{formatUsdc(s)}</span>;

function Ready({ intent, amount, quote, onGo, onKeep }: ReceiveStepProps) {
  const keep = (
    <button type="button" className="wz-btn wz-btn-text" onClick={onKeep}>
      Keep as USDC
    </button>
  );
  if (intent.kind === "xlm") {
    const q = quote.kind === "ok" ? quote.xlmOut : null;
    return (
      <div className="wz-stack" style={{ gap: 12 }}>
        <p className="wz-strong">
          Convert {usdc(amount)} USDC to {q !== null ? <>about <span className="mono">{formatUsdc(q)}</span> XLM</> : "XLM"}.
        </p>
        <p className="wz-hint">
          {q !== null ? (
            <>
              You get at least <span className="mono">{formatUsdc(minOut(q, intent.slippageBp))}</span> XLM or the swap does not happen.{" "}
            </>
          ) : quote.kind === "failed" ? (
            "The price could not be read. Try again in a moment. "
          ) : (
            "Getting the price. "
          )}
          Your debt stays in USDC; if the price of XLM moves, what you owe in XLM terms changes.
        </p>
        <div className="wz-actions">
          <button type="button" className="wz-btn wz-btn-gold" onClick={q !== null ? onGo : undefined} aria-disabled={q === null}>
            Convert to XLM
          </button>
          {keep}
        </div>
      </div>
    );
  }
  return (
    <div className="wz-stack" style={{ gap: 12 }}>
      <p className="wz-strong">
        Send {usdc(amount)} USDC to <span className="mono">{shortAddress(intent.recipient, 6, 4)}</span> on {DEST}.
      </p>
      <p className="wz-hint">Your wallet asks twice: allow, then send. Circle moves the USDC; nothing is wrapped.</p>
      <div className="wz-actions">
        <button type="button" className="wz-btn wz-btn-gold" onClick={onGo}>
          Send to {DEST}
        </button>
        {keep}
      </div>
    </div>
  );
}

function Recover({ intent, amount, flow, walletName, onGo, onKeep }: ReceiveStepProps) {
  const declined = flow.phase === "signature_cancelled";
  const what = intent.kind === "xlm" ? "conversion" : "transfer";
  return (
    <Notice
      tone="info"
      label="Your USDC is safe"
      actions={
        <>
          <button type="button" className="wz-btn wz-btn-gold wz-btn-sm" onClick={onGo}>
            Try again
          </button>
          <button type="button" className="wz-btn wz-btn-text wz-btn-sm" onClick={onKeep}>
            Keep as USDC
          </button>
        </>
      }
    >
      <p>
        You have your {usdc(amount)} USDC in your Stellar wallet. Nothing was lost.{" "}
        {declined
          ? `You declined in ${walletName}.`
          : intent.kind === "xlm"
            ? "The conversion didn't go through, maybe because the price moved. Trying again gets a fresh price."
            : `The ${what} didn't go through.`}
      </p>
    </Notice>
  );
}

function XlmDone({ amount, swap }: ReceiveStepProps) {
  if (!swap) return null;
  const got = swap.received ?? swap.minOut;
  return (
    <Notice tone="positive" label="Done">
      <p>
        Converted {usdc(amount)} USDC to {swap.received === null ? "at least " : ""}
        <span className="mono">{formatUsdc(got)}</span> XLM. It&apos;s in your Stellar wallet. Your debt stays in USDC.{" "}
        <ExternalLink href={stellarTxUrl(swap.hash)}>View transaction</ExternalLink>
      </p>
    </Notice>
  );
}

function ChainProgress({ phase, leg, mintHash }: ReceiveStepProps) {
  if (leg.kind === "idle") return null;
  const confirmed = phase === "chain_confirmed" || phase === "chain_arrived";
  const arrived = phase === "chain_arrived";
  return (
    <div className="wz-stack" style={{ gap: 12 }}>
      <p className="wz-strong">
        {arrived ? "Arrived" : "On its way"}: {usdc(leg.send.amount)} USDC to{" "}
        <span className="mono">{shortAddress(leg.recipient, 6, 4)}</span> on {DEST}.
      </p>
      <ol className="wz-steps" aria-live="polite" aria-label={`Transfer to ${DEST}`}>
        <li data-state="done">
          <i aria-hidden="true" />
          Sent from Stellar <ExternalLink href={stellarTxUrl(leg.send.burnHash)}>View</ExternalLink>
        </li>
        <li data-state={confirmed ? "done" : "now"}>
          <i aria-hidden="true" />
          {confirmed ? "Circle confirmed" : "Circle confirms, usually in under a minute"}
        </li>
        <li data-state={arrived ? "done" : confirmed ? "now" : undefined}>
          <i aria-hidden="true" />
          {arrived ? (
            <>
              Arrived on {DEST} <ExternalLink href={destinationTxUrl(mintHash!)}>View</ExternalLink>
            </>
          ) : (
            `Arrives on ${DEST}`
          )}
        </li>
      </ol>
    </div>
  );
}

/** Step 2 of a borrow: the USDC is already in the wallet; this converts or sends it as the borrower chose. */
export function ReceiveStepView(p: ReceiveStepProps) {
  let body;
  switch (p.phase) {
    case "kept":
      return null;
    case "ready":
      body = <Ready {...p} />;
      break;
    case "running":
      body = <TxRunning flow={p.flow} walletName={p.walletName} />;
      break;
    case "recover":
      body = <Recover {...p} />;
      break;
    case "xlm_done":
      body = <XlmDone {...p} />;
      break;
    default:
      body = <ChainProgress {...p} />;
  }
  const done = p.phase === "xlm_done" || p.phase === "chain_arrived";
  return (
    <section className="wz-stack" style={{ gap: 12 }} aria-label="Step 2 of 2">
      <p className="wz-hint">{done ? "Step 2 of 2 done" : "Step 2 of 2"}</p>
      {body}
    </section>
  );
}

/** `ReceiveStepView` on the live wallet, router and Circle. */
export function ReceiveStep({
  intent,
  amount,
  walletName,
  mintHash = null,
  onKeep,
}: {
  intent: ReceiveStepProps["intent"];
  amount: bigint;
  walletName: string;
  mintHash?: string | null;
  onKeep?: () => void;
}) {
  const r = useReceive();
  const [kept, setKept] = useState(false);
  const quote = useXlmQuote(intent.kind === "xlm" ? amount : null);
  const phase = receivePhase({ intent, flow: r.flow, swap: r.swap, leg: r.leg, mintHash, kept });
  const onGo = () =>
    void (intent.kind === "xlm" ? r.toXlm(amount, intent.slippageBp) : r.toChain(amount, intent.recipient));
  return (
    <ReceiveStepView
      intent={intent}
      amount={amount}
      phase={phase}
      flow={r.flow}
      quote={quote}
      swap={r.swap}
      leg={r.leg}
      mintHash={mintHash}
      walletName={walletName}
      onGo={onGo}
      onKeep={() => {
        setKept(true);
        onKeep?.();
      }}
    />
  );
}
