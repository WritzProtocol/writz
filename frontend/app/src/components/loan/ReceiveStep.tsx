"use client";

import { useEffect, useState } from "react";
import { config } from "@/config";
import { formatUsdc, shortAddress } from "@/lib/borrow/journey";
import { stellarTxUrl } from "@/lib/explorer";
import type { FlowState } from "@/lib/flow/engine";
import { destinationTxUrl } from "@/lib/receive/cctp";
import { deliveryOf, nextRelayPoll, RELAY_POLL_MS, startDelivery, type Delivery } from "@/lib/receive/relay";
import { receivePhase, type ReceiveIntent, type ReceivePhase } from "@/lib/receive/intent";
import { debtLine, swapAsset } from "@/lib/receive/assets";
import { minOut, type SwapResult } from "@/lib/receive/swap";
import { useReceive, useSwapQuote, type ChainLeg, type SwapQuote } from "@/lib/receive/useReceive";
import { ExternalLink, Notice } from "@/components/ui";
import { TxRunning } from "./parts";

const DEST = config.receive.cctp.destination.name;

export interface ReceiveStepProps {
  intent: Exclude<ReceiveIntent, { kind: "usdc" }>;
  /** USDC stroops the borrow just paid into the wallet. */
  amount: bigint;
  phase: ReceivePhase;
  flow: FlowState;
  quote: SwapQuote;
  swap: SwapResult | null;
  leg: ChainLeg;
  mintHash: string | null;
  walletName: string;
  onGo: () => void;
  onKeep: () => void;
  /** Where the Writz relay stands on delivering a Base Sepolia transfer, once it was asked. */
  relay?: Delivery | null;
  /** Starts a failed delivery over, offered only when the relay says it can be. */
  onRetryRelay?: () => void;
}

const usdc = (s: bigint) => <span className="mono">{formatUsdc(s)}</span>;

/** The ticker a swap intent delivers, for copy; the id upper-cased if this build does not configure it. */
const swapLabel = (intent: ReceiveStepProps["intent"]) =>
  intent.kind === "swap" ? (swapAsset(intent.asset)?.label ?? intent.asset.toUpperCase()) : "USDC";

function Ready({ intent, amount, quote, onGo, onKeep }: ReceiveStepProps) {
  const keep = (
    <button type="button" className="wz-btn wz-btn-text" onClick={onKeep}>
      Keep as USDC
    </button>
  );
  if (intent.kind === "swap") {
    const a = swapAsset(intent.asset);
    const label = swapLabel(intent);
    const q = quote.kind === "ok" ? quote.out : null;
    return (
      <div className="wz-stack" style={{ gap: 12 }}>
        <p className="wz-strong">
          Convert {usdc(amount)} USDC to {q !== null ? <>about <span className="mono">{formatUsdc(q)}</span> {label}</> : label}.
        </p>
        <p className="wz-hint">
          {q !== null ? (
            <>
              You get at least <span className="mono">{formatUsdc(minOut(q, intent.slippageBp))}</span> {label} or the swap does not happen.{" "}
            </>
          ) : quote.kind === "failed" ? (
            "The price could not be read. Try again in a moment. "
          ) : (
            "Getting the price. "
          )}
          {a ? debtLine(a) : null}
          {a?.classic ? ` If ${label} is not in your wallet yet, it asks once more to add it.` : null}
        </p>
        <div className="wz-actions">
          <button type="button" className="wz-btn wz-btn-gold" onClick={q !== null ? onGo : undefined} aria-disabled={q === null}>
            Convert to {label}
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
  const what = intent.kind === "swap" ? "conversion" : "transfer";
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
          : intent.kind === "swap"
            ? "The conversion didn't go through, maybe because the price moved. Trying again gets a fresh price."
            : `The ${what} didn't go through.`}
      </p>
    </Notice>
  );
}

function SwapDone({ intent, amount, swap }: ReceiveStepProps) {
  if (!swap) return null;
  const label = swapLabel(intent);
  const got = swap.received ?? swap.minOut;
  return (
    <Notice tone="positive" label="Done">
      <p>
        Converted {usdc(amount)} USDC to {swap.received === null ? "at least " : ""}
        <span className="mono">{formatUsdc(got)}</span> {label}. It&apos;s in your Stellar wallet. Your debt stays in USDC.{" "}
        <ExternalLink href={stellarTxUrl(swap.hash)}>View transaction</ExternalLink>
      </p>
    </Notice>
  );
}

function ChainProgress({ phase, leg, mintHash, relay, onRetryRelay }: ReceiveStepProps) {
  if (leg.kind === "idle") return null;
  const arrived = phase === "chain_arrived" || relay?.kind === "arrived";
  const confirmed = phase === "chain_confirmed" || arrived;
  const retrying = relay?.kind === "pending" ? relay.retrying : null;
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
        <li data-state={arrived ? "done" : confirmed && relay?.kind !== "disabled" && relay?.kind !== "failed" ? "now" : undefined}>
          <i aria-hidden="true" />
          {arrived ? (
            mintHash ? (
              <>
                Arrived on {DEST} <ExternalLink href={destinationTxUrl(mintHash)}>View</ExternalLink>
              </>
            ) : (
              `Arrived on ${DEST}. Finding the transaction`
            )
          ) : relay?.kind === "disabled" ? (
            `Delivery on ${DEST} is pending`
          ) : relay?.kind === "failed" ? (
            `Not delivered on ${DEST}`
          ) : (
            `Arrives on ${DEST}`
          )}
        </li>
      </ol>
      {retrying && (
        <p className="wz-hint" aria-live="polite">
          Delivery is being retried ({retrying.reason}). It continues on its own; you can leave this page.
        </p>
      )}
      {relay?.kind === "disabled" && (
        <Notice tone="info" label="Pending">
          <p>The relay that completes transfers on {DEST} isn&apos;t running right now. Your transfer waits for it; nothing was lost.</p>
        </Notice>
      )}
      {relay?.kind === "failed" && (
        <Notice
          tone="warning"
          label="Not delivered"
          actions={
            relay.retryable && onRetryRelay ? (
              <button type="button" className="wz-btn wz-btn-gold wz-btn-sm" onClick={onRetryRelay}>
                Try again
              </button>
            ) : undefined
          }
        >
          <p>The relay could not complete this transfer: {relay.reason}.</p>
        </Notice>
      )}
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
    case "swap_done":
      body = <SwapDone {...p} />;
      break;
    default:
      body = <ChainProgress {...p} />;
  }
  const done = p.phase === "swap_done" || p.phase === "chain_arrived" || p.relay?.kind === "arrived";
  return (
    <section className="wz-stack" style={{ gap: 12 }} aria-label="Step 2 of 2">
      <p className="wz-hint">{done ? "Step 2 of 2 done" : "Step 2 of 2"}</p>
      {body}
    </section>
  );
}

/**
 * The Writz relay's delivery of a Base Sepolia transfer: asked once after the
 * burn, then read as `nextRelayPoll` says until it arrives, fails or the
 * relay is off. `retry` asks again, which starts a retryable failure over.
 */
function useRelayDelivery(burnHash: string | null, given: string | null): { delivery: Delivery | null; retry: () => void } {
  const [state, setState] = useState<{ burn: string; delivery: Delivery } | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!burnHash || given) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A failed read is asked again; the relay keeps working on the transfer meanwhile.
    const again = () => {
      if (live) timer = setTimeout(poll, RELAY_POLL_MS);
    };
    const settle = (delivery: Delivery) => {
      if (!live) return;
      setState({ burn: burnHash, delivery });
      const wait = nextRelayPoll(delivery);
      if (wait !== null) timer = setTimeout(poll, wait);
    };
    function poll() {
      void deliveryOf(burnHash!).then(settle, again);
    }
    void startDelivery(burnHash).then(settle, again);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [burnHash, given, round]);
  return { delivery: state && state.burn === burnHash ? state.delivery : null, retry: () => setRound((r) => r + 1) };
}

/** A settled step 2 transaction, reported so the loan's timeline can show it. */
export interface ReceivedLeg {
  hash: string;
  chain: "stellar" | "base-sepolia";
  label: string;
}

/** `ReceiveStepView` on the live wallet, router and Circle. */
export function ReceiveStep({
  intent,
  amount,
  walletName,
  mintHash: givenMint = null,
  onKeep,
  onReceived,
}: {
  intent: ReceiveStepProps["intent"];
  amount: bigint;
  walletName: string;
  mintHash?: string | null;
  onKeep?: () => void;
  onReceived?: (leg: ReceivedLeg) => void;
}) {
  const r = useReceive();
  const relay = useRelayDelivery(r.leg.kind === "idle" ? null : r.leg.send.burnHash, givenMint);
  const mintHash = givenMint ?? (relay.delivery?.kind === "arrived" ? relay.delivery.mintHash : null);
  const swapHash = r.swap?.hash ?? null;
  const burnHash = r.leg.kind === "idle" ? null : r.leg.send.burnHash;
  const asset = intent.kind === "swap" ? swapAsset(intent.asset) : null;
  const receivedLabel = `Received as ${asset?.label ?? "USDC"}`;
  useEffect(() => {
    if (swapHash) onReceived?.({ hash: swapHash, chain: "stellar", label: receivedLabel });
  }, [swapHash, receivedLabel, onReceived]);
  useEffect(() => {
    if (burnHash) onReceived?.({ hash: burnHash, chain: "stellar", label: `Sent to ${DEST}` });
  }, [burnHash, onReceived]);
  useEffect(() => {
    if (mintHash) onReceived?.({ hash: mintHash, chain: "base-sepolia", label: `Received on ${DEST}` });
  }, [mintHash, onReceived]);
  const [kept, setKept] = useState(false);
  const quote = useSwapQuote(asset?.token ?? null, asset ? amount : null);
  const phase = receivePhase({ intent, flow: r.flow, swap: r.swap, leg: r.leg, mintHash, kept });
  const onGo = () => {
    if (intent.kind === "chain") void r.toChain(amount, intent.recipient);
    else if (asset) void r.toAsset(asset, amount, intent.slippageBp);
  };
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
      relay={givenMint ? null : relay.delivery}
      onRetryRelay={relay.retry}
      walletName={walletName}
      onGo={onGo}
      onKeep={() => {
        setKept(true);
        onKeep?.();
      }}
    />
  );
}
