/**
 * Decodes commitment-tree events into tree updates. Kept apart from the
 * poller so it can be tested without opening the leaf store.
 */
import type { TreeEvent } from "./apply.js";

export interface DecodedTreeEvent {
  event: TreeEvent | undefined;
  encNote?: string;
}

const toBig = (bytes: Uint8Array) => BigInt("0x" + Buffer.from(bytes).toString("hex"));

/** Decodes an `insert_leaf`, `borrow` or `repay` event; anything else is ignored. */
export function decodeTreeEvent(raw: { topic: unknown[]; value: unknown }): DecodedTreeEvent {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scValToNative } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const name = raw.topic[0] ? (scValToNative(raw.topic[0] as never) as string) : undefined;
  if (name !== "insert_leaf" && name !== "borrow" && name !== "repay") return { event: undefined };
  const newRoot = toBig(scValToNative(raw.topic[1] as never) as Uint8Array);
  const v = scValToNative(raw.value as never) as {
    commitment?: Uint8Array;
    leaf_index?: number;
    new_commitment?: Uint8Array;
    enc_note?: Uint8Array;
  };
  if (name === "insert_leaf") {
    if (!v.commitment || v.leaf_index === undefined) return { event: undefined };
    return { event: { kind: "insert", commitment: toBig(v.commitment), leafIndex: Number(v.leaf_index), newRoot } };
  }
  if (!v.new_commitment) return { event: undefined };
  const encNote = v.enc_note && v.enc_note.length > 0 ? Buffer.from(v.enc_note).toString("hex") : undefined;
  return { event: { kind: "update", newCommitment: toBig(v.new_commitment), newRoot }, ...(encNote ? { encNote } : {}) };
}
