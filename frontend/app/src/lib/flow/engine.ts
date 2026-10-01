/**
 * Transaction lifecycle shared by every flow. Flows report
 * progress as typed events; components render from the reduced state and
 * never parse human-readable strings.
 */

import { isSignatureRejected, SignatureRejectedError } from "@/lib/wallet/rejection";

export type Wallet = "stellar" | "bitcoin";

export type PrepareStep =
  | "locating_output"
  | "merkle_path"
  | "building"
  | "cosign"
  | "broadcasting";

export type AttentionAction = "finish_deposit";

export type FlowState =
  | { phase: "idle" }
  | { phase: "preparing"; step?: PrepareStep; hash?: string }
  | {
      phase: "waiting_btc";
      confirmations: number;
      required: number;
      relayerReachable: boolean;
    }
  | { phase: "ready" }
  | { phase: "proving" }
  | { phase: "awaiting_signature"; wallet: Wallet; hash?: string }
  | { phase: "submitted"; hash: string }
  | { phase: "post_processing"; step: "insert" | "update_leaf"; hash?: string }
  | { phase: "settled"; hash?: string; syncPending?: boolean }
  | { phase: "signature_cancelled"; wallet: Wallet; walletName?: string; hash?: string }
  | { phase: "timed_out"; hash: string }
  | { phase: "failed"; error: unknown; hash?: string }
  | { phase: "needs_attention"; action: AttentionAction; error?: unknown; hash?: string };

export type FlowPhase = FlowState["phase"];

export type FlowEvent =
  | { type: "start" }
  | { type: "reset" }
  | { type: "preparing"; step?: PrepareStep }
  | { type: "btc_confirmations"; confirmations: number; required: number }
  | { type: "relayer_unreachable"; required: number }
  | { type: "ready" }
  | { type: "proving" }
  | { type: "awaiting_signature"; wallet: Wallet }
  | { type: "signature_cancelled"; walletName?: string }
  | { type: "submitted"; hash: string }
  | { type: "post_processing"; step: "insert" | "update_leaf" }
  | { type: "settled"; hash?: string; syncPending?: boolean }
  | { type: "timed_out"; hash: string }
  | { type: "failed"; error: unknown }
  | { type: "needs_attention"; action: AttentionAction; error?: unknown; hash?: string };

export type Emit = (event: FlowEvent) => void;

export const IDLE: FlowState = { phase: "idle" };

const TERMINAL: ReadonlySet<FlowPhase> = new Set([
  "idle",
  "ready",
  "settled",
  "signature_cancelled",
  "timed_out",
  "failed",
  "needs_attention",
]);

export function isTerminal(state: FlowState): boolean {
  return TERMINAL.has(state.phase);
}

/** The hash of the transaction this flow submitted, once one exists. */
export function hashOf(state: FlowState): string | undefined {
  return "hash" in state ? state.hash : undefined;
}

/**
 * Pure transition function. A terminal state only leaves through `start`,
 * `reset`, or the outcome of a reconciled `timed_out`, so a late event from an
 * abandoned run cannot overwrite what the user is looking at.
 */
export function reduceFlow(state: FlowState, event: FlowEvent): FlowState {
  if (event.type === "reset") return IDLE;
  if (event.type === "start") return { phase: "preparing" };

  if (isTerminal(state)) {
    const reconciled =
      state.phase === "timed_out" && (event.type === "settled" || event.type === "failed");
    const resumed =
      (state.phase === "idle" || state.phase === "ready") &&
      event.type !== "signature_cancelled";
    if (!reconciled && !resumed) return state;
  }

  const hash = hashOf(state);

  switch (event.type) {
    case "preparing":
      return { phase: "preparing", step: event.step, hash };
    case "btc_confirmations":
      return {
        phase: "waiting_btc",
        confirmations: event.confirmations,
        required: event.required,
        relayerReachable: true,
      };
    case "relayer_unreachable":
      return {
        phase: "waiting_btc",
        confirmations: state.phase === "waiting_btc" ? state.confirmations : 0,
        required: event.required,
        relayerReachable: false,
      };
    case "ready":
      return { phase: "ready" };
    case "proving":
      return { phase: "proving" };
    case "awaiting_signature":
      return { phase: "awaiting_signature", wallet: event.wallet, hash };
    case "signature_cancelled":
      if (state.phase !== "awaiting_signature") return state;
      return { phase: "signature_cancelled", wallet: state.wallet, walletName: event.walletName, hash };
    case "submitted":
      return { phase: "submitted", hash: event.hash };
    case "post_processing":
      return { phase: "post_processing", step: event.step, hash };
    case "settled":
      return { phase: "settled", hash: event.hash ?? hash, syncPending: event.syncPending };
    case "timed_out":
      return { phase: "timed_out", hash: event.hash };
    case "failed":
      if (state.phase === "awaiting_signature" && isSignatureRejected(event.error)) {
        const walletName = event.error instanceof SignatureRejectedError ? event.error.walletName : undefined;
        return { phase: "signature_cancelled", wallet: state.wallet, walletName, hash };
      }
      return { phase: "failed", error: event.error, hash };
    case "needs_attention":
      return {
        phase: "needs_attention",
        action: event.action,
        error: event.error,
        hash: event.hash ?? hash,
      };
  }
}

/** Something is running in this tab (drives the disconnect confirmation and disables inputs). */
export function isInFlight(state: FlowState): boolean {
  return !isTerminal(state);
}

/** Leaving now could lose a signature or a submission. */
export function guardsUnload(state: FlowState): boolean {
  return (
    state.phase === "awaiting_signature" ||
    state.phase === "submitted" ||
    state.phase === "post_processing"
  );
}
