import { isInFlight, type FlowState } from "@/lib/flow/engine";
import type { ChainLeg } from "./useReceive";
import type { SwapResult } from "./swap";

/** How the borrower asked to receive the loan, chosen before borrowing. */
export type ReceiveIntent =
  | { kind: "usdc" }
  | { kind: "xlm"; slippageBp: number }
  | { kind: "chain"; recipient: string };

/** Where step 2 stands once the USDC is in the wallet. */
export type ReceivePhase =
  | "ready"
  | "running"
  | "recover"
  | "kept"
  | "xlm_done"
  | "chain_sent"
  | "chain_confirmed"
  | "chain_arrived";

export function receivePhase(s: {
  intent: ReceiveIntent;
  flow: FlowState;
  swap: SwapResult | null;
  leg: ChainLeg;
  mintHash: string | null;
  kept: boolean;
}): ReceivePhase {
  if (s.kept || s.intent.kind === "usdc") return "kept";
  if (s.intent.kind === "xlm" && s.swap) return "xlm_done";
  if (s.intent.kind === "chain" && s.leg.kind !== "idle") {
    if (s.mintHash) return "chain_arrived";
    return s.leg.kind === "confirmed" ? "chain_confirmed" : "chain_sent";
  }
  if (isInFlight(s.flow)) return "running";
  if (s.flow.phase === "failed" || s.flow.phase === "signature_cancelled" || s.flow.phase === "timed_out") return "recover";
  return "ready";
}
