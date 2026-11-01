import type { SendOutcome } from "./outbox";
import type { OutboxEntry } from "./outboxStore";

/**
 * How the outbox talks to the relayer and reads the chain (#267). Kept apart
 * from the retry logic so both can be tested without a network.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return `${res.status}${body?.error ? ` ${body.error}` : ""}`;
}

/** Posts the entry to `/insert-commitment` or `/update-leaf`. */
export async function sendToRelayer(entry: OutboxEntry, relayerUrl: string, fetchFn: Fetch = fetch): Promise<SendOutcome> {
  if (!relayerUrl) return { kind: "failed", error: "NEXT_PUBLIC_RELAYER_URL is not configured" };
  const res = await fetchFn(`${relayerUrl}/${entry.kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry.payload),
  }).catch((e: unknown) => e as Error);
  if (res instanceof Error) return { kind: "failed", error: `unreachable: ${res.message}` };
  if (res.ok) return { kind: "accepted" };
  if (res.status === 409) return { kind: "behind", error: await errorOf(res) };
  return { kind: "failed", error: await errorOf(res) };
}

export interface ChainReads {
  /** `commitment-tree.is_commitment_pending`. */
  isCommitmentPending(commitmentHex: string): Promise<boolean>;
  relayerUrl: string;
  fetchFn?: Fetch;
}

/**
 * True when the call has nothing left to do:
 * - insert: the confirmed deposit's commitment is no longer pending, so it is in the tree;
 * - update: the relayer's tree, checked against the on-chain root, holds the new commitment at that leaf.
 */
export async function isAppliedOnChain(entry: OutboxEntry, reads: ChainReads): Promise<boolean> {
  if (entry.kind === "insert-commitment") {
    return !(await reads.isCommitmentPending(entry.payload.commitment));
  }
  if (!reads.relayerUrl) return false;
  const qs = new URLSearchParams({ commitment: entry.payload.newCommitment, leafIndex: String(entry.payload.leafIndex) });
  // /merkle-path answers 200 only for a leaf in a store that matches the
  // on-chain root, so a stale store (409) or a missing leaf (404) is "not yet".
  const res = await (reads.fetchFn ?? fetch)(`${reads.relayerUrl}/merkle-path?${qs}`).catch(() => null);
  return res?.ok === true;
}
