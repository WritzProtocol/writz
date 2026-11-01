import { config } from "@/config";
import { isCommitmentPending } from "@/lib/contracts/commitmentTree";
import type { OutboxDeps } from "./outbox";
import { createIndexedDbOutboxStore, createMemoryOutboxStore, outboxOwner, type OutboxStore } from "./outboxStore";
import { isAppliedOnChain, sendToRelayer } from "./outboxTransport";

/**
 * The app's relayer outbox (#267), shared by the background runner and any
 * flow that records a call with `trackRelayerCall`. IndexedDB when the browser
 * has it; otherwise an in-memory store, which still retries within the tab.
 */
let store: OutboxStore | null = null;

function appStore(): OutboxStore {
  return (store ??= createIndexedDbOutboxStore() ?? createMemoryOutboxStore());
}

export function appOutboxDeps(): OutboxDeps {
  const relayerUrl = config.services.relayerUrl;
  return {
    store: appStore(),
    send: (entry) => sendToRelayer(entry, relayerUrl),
    isApplied: (entry) => isAppliedOnChain(entry, { isCommitmentPending, relayerUrl }),
  };
}

/** The outbox key for a connected wallet on this build's network. */
export function appOutboxOwner(address: string): string {
  return outboxOwner(config.target, address);
}
