import { humanizeError, type ErrorContext } from "@/lib/errors";
import type { FlowState } from "@/lib/flow/engine";
import { TxLink } from "./TxLink";

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
      return <p className="text-xs text-body">You declined in your wallet. Nothing was sent.</p>;
    case "timed_out":
      return (
        <p className="break-all text-xs text-amber">
          Your transaction was sent but isn&apos;t confirmed yet. It may still go through.
          Don&apos;t send it again. {link}
        </p>
      );
    case "failed":
      return (
        <p className="break-all text-xs text-crit">
          {humanizeError(flow.error, errorContext)} {link}
        </p>
      );
    default:
      return null;
  }
}
