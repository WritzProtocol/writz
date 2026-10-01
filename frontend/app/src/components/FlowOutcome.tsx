import type { ErrorContext } from "@/lib/errors";
import type { FlowState } from "@/lib/flow/engine";
import { ErrorNotice } from "./ErrorNotice";
import { TxLink } from "./TxLink";

/** The neutral line for a declined signature, naming the wallet that asked. */
export function declinedLine(flow: Extract<FlowState, { phase: "signature_cancelled" }>): string {
  const wallet = flow.walletName ?? (flow.wallet === "bitcoin" ? "Xverse" : "your wallet");
  return `You declined in ${wallet}. Nothing was sent.`;
}

/** Button label while a flow runs, by lifecycle phase. */
export function workingLabel(flow: FlowState, idle: string): string {
  switch (flow.phase) {
    case "preparing":
      return "Preparing…";
    case "proving":
      return "Proving…";
    case "awaiting_signature":
      return "Confirm in wallet…";
    case "submitted":
      return "Submitting…";
    case "post_processing":
      return "Syncing…";
    default:
      return idle;
  }
}

/** The result line under an action: success, decline, unconfirmed or failure, with the tx link once a hash exists. */
export function FlowOutcome({
  flow,
  success,
  errorContext,
  txUrl,
}: {
  flow: FlowState;
  success: string;
  errorContext?: ErrorContext;
  txUrl: (hash: string) => string;
}) {
  const hash = "hash" in flow ? flow.hash : undefined;
  const link = hash ? <TxLink url={txUrl(hash)} hash={hash} /> : null;
  switch (flow.phase) {
    case "settled":
      return (
        <p className="break-all text-xs text-ok">
          {success}
          {flow.syncPending ? " Writz is catching up. It retries on its own." : ""} {link}
        </p>
      );
    case "signature_cancelled":
      return <p className="text-xs text-body">{declinedLine(flow)}</p>;
    case "timed_out":
      return (
        <p className="break-all text-xs text-amber">
          Your transaction was sent but isn&apos;t confirmed yet. It may still go through.
          Don&apos;t send it again. {link}
        </p>
      );
    case "failed":
      return (
        <ErrorNotice error={flow.error} context={errorContext} hash={hash}>
          {link}
        </ErrorNotice>
      );
    default:
      return null;
  }
}
