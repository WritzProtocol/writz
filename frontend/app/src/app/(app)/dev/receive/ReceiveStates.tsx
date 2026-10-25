"use client";

import { ReceiveStepView, type ReceiveStepProps } from "@/components/loan/ReceiveStep";
import { IDLE } from "@/lib/flow/engine";
import type { ChainLeg } from "@/lib/receive/useReceive";

const AMOUNT = 1_000_000_000n;
const RECIPIENT = "0x7a3f9c2b41d08e5a6b2c9d1e4f7a8b3c5d6e9f01";
const XLM = { kind: "xlm" as const, slippageBp: 50 };
const CHAIN = { kind: "chain" as const, recipient: RECIPIENT };
const send = { burnHash: "e378cd985e41b167c4bc9565d397f3f9642c34be2919394b8f0881cc26f78a79", amount: AMOUNT, maxFee: 0n };
const sent: ChainLeg = { kind: "sent", send, recipient: RECIPIENT };
const confirmed: ChainLeg = { ...sent, kind: "confirmed", message: "0x", attestation: "0x" };
const noop = () => {};

const base: Omit<ReceiveStepProps, "intent" | "phase"> = {
  amount: AMOUNT,
  flow: IDLE,
  quote: { kind: "ok", amountIn: AMOUNT, xlmOut: 9_305_340_000n },
  swap: null,
  leg: { kind: "idle" },
  mintHash: null,
  walletName: "Freighter",
  onGo: noop,
  onKeep: noop,
};

const STATES: { id: string; title: string; props: ReceiveStepProps }[] = [
  { id: "x1", title: "XLM: ready, price read", props: { ...base, intent: XLM, phase: "ready" } },
  { id: "x2", title: "XLM: ready, getting the price", props: { ...base, intent: XLM, phase: "ready", quote: { kind: "checking" } } },
  { id: "x3", title: "XLM: price unreadable", props: { ...base, intent: XLM, phase: "ready", quote: { kind: "failed" } } },
  { id: "x4", title: "XLM: confirm in wallet", props: { ...base, intent: XLM, phase: "running", flow: { phase: "awaiting_signature", wallet: "stellar" } } },
  { id: "x5", title: "XLM: declined", props: { ...base, intent: XLM, phase: "recover", flow: { phase: "signature_cancelled", wallet: "stellar" } } },
  { id: "x6", title: "XLM: failed, price moved", props: { ...base, intent: XLM, phase: "recover", flow: { phase: "failed", error: new Error("Error(Contract, #11)") } } },
  {
    id: "x7",
    title: "XLM: converted",
    props: { ...base, intent: XLM, phase: "xlm_done", swap: { hash: "523d4d2d3e3b84db8ee001bebfe525f12b0760a743f17a368c3c80bad68eea55", quotedOut: 9_305_340_000n, minOut: 9_258_813_300n, received: 9_302_118_000n } },
  },
  { id: "c1", title: "Base Sepolia: ready", props: { ...base, intent: CHAIN, phase: "ready" } },
  { id: "c2", title: "Base Sepolia: confirm in wallet", props: { ...base, intent: CHAIN, phase: "running", flow: { phase: "awaiting_signature", wallet: "stellar" } } },
  { id: "c3", title: "Base Sepolia: declined", props: { ...base, intent: CHAIN, phase: "recover", flow: { phase: "signature_cancelled", wallet: "stellar" } } },
  { id: "c4", title: "Base Sepolia: sent from Stellar", props: { ...base, intent: CHAIN, phase: "chain_sent", leg: sent } },
  { id: "c5", title: "Base Sepolia: Circle confirmed", props: { ...base, intent: CHAIN, phase: "chain_confirmed", leg: confirmed } },
  { id: "c6", title: "Base Sepolia: arrived", props: { ...base, intent: CHAIN, phase: "chain_arrived", leg: confirmed, mintHash: "0x9b1c" + "0".repeat(60) } },
  {
    id: "c7",
    title: "Base Sepolia: relay retrying",
    props: { ...base, intent: CHAIN, phase: "chain_confirmed", leg: confirmed, relay: { kind: "pending", retrying: { reason: "the relay account is out of gas", nextRetryAt: null } } },
  },
  {
    id: "c8",
    title: "Base Sepolia: arrived, finding the transaction",
    props: { ...base, intent: CHAIN, phase: "chain_confirmed", leg: confirmed, relay: { kind: "arrived", mintHash: null } },
  },
  {
    id: "c9",
    title: "Base Sepolia: relay off, delivery pending",
    props: { ...base, intent: CHAIN, phase: "chain_confirmed", leg: confirmed, relay: { kind: "disabled", reason: "no relay key is configured" } },
  },
  {
    id: "c10",
    title: "Base Sepolia: not delivered, can try again",
    props: {
      ...base,
      intent: CHAIN,
      phase: "chain_confirmed",
      leg: confirmed,
      relay: { kind: "failed", reason: "the relay stopped after 24 hours of retrying (Base Sepolia could not be reached); ask again to start over", retryable: true },
      onRetryRelay: noop,
    },
  },
  {
    id: "c11",
    title: "Base Sepolia: not delivered, final",
    props: { ...base, intent: CHAIN, phase: "chain_confirmed", leg: confirmed, relay: { kind: "failed", reason: "Base Sepolia refused the mint: Invalid signature", retryable: false } },
  },
];

export function ReceiveStates() {
  return (
    <div className="wz-stack" style={{ gap: 32 }}>
      {STATES.map((s) => (
        <section key={s.id} id={`rx-${s.id}`} className="dv-group" aria-labelledby={`rx-${s.id}-h`}>
          <h2 id={`rx-${s.id}-h`}>
            {s.title} <span className="dv-count">{s.id}</span>
          </h2>
          <div style={{ maxWidth: 520 }}>
            <ReceiveStepView {...s.props} />
          </div>
        </section>
      ))}
    </div>
  );
}
