import { describe, expect, it } from "bun:test";
import { IDLE, type FlowState } from "@/lib/flow/engine";
import { receivePhase, type ReceiveIntent } from "./intent";
import type { ChainLeg } from "./useReceive";

const XLM: ReceiveIntent = { kind: "swap", asset: "xlm", slippageBp: 50 };
const CHAIN: ReceiveIntent = { kind: "chain", recipient: "0x" + "ab".repeat(20) };
const send = { burnHash: "b".repeat(64), amount: 1_000_000_000n, maxFee: 0n };
const base = { flow: IDLE, swap: null, leg: { kind: "idle" } as ChainLeg, mintHash: null, kept: false };
const phase = (intent: ReceiveIntent, over: Partial<typeof base> = {}) => receivePhase({ ...base, intent, ...over });

describe("receivePhase", () => {
  it("has nothing to do for USDC or once the borrower keeps it", () => {
    expect(phase({ kind: "usdc" })).toBe("kept");
    expect(phase(XLM, { kept: true })).toBe("kept");
  });

  it("waits for the second signature, then runs", () => {
    expect(phase(XLM)).toBe("ready");
    expect(phase(XLM, { flow: { phase: "awaiting_signature", wallet: "stellar" } })).toBe("running");
  });

  it("offers recovery when the second step does not land", () => {
    const failed: FlowState = { phase: "failed", error: new Error("x") };
    expect(phase(XLM, { flow: failed })).toBe("recover");
    expect(phase(CHAIN, { flow: { phase: "signature_cancelled", wallet: "stellar" } })).toBe("recover");
  });

  it("finishes the swap", () => {
    expect(phase(XLM, { swap: { hash: "h", quotedOut: 1n, minOut: 1n, received: 1n } })).toBe("swap_done");
  });

  it("follows the other chain from sent to arrived", () => {
    expect(phase(CHAIN, { leg: { kind: "sent", send, recipient: CHAIN.recipient } })).toBe("chain_sent");
    const confirmed: ChainLeg = { kind: "confirmed", send, recipient: CHAIN.recipient, message: "0x", attestation: "0x" };
    expect(phase(CHAIN, { leg: confirmed })).toBe("chain_confirmed");
    expect(phase(CHAIN, { leg: confirmed, mintHash: "0xmint" })).toBe("chain_arrived");
  });
});
