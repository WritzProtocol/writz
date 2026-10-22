/**
 * Decodes commitment-tree events into tree updates. Kept apart from the
 * poller so it can be tested without opening the leaf store.
 */
import type { xdr as Xdr } from "@stellar/stellar-sdk";
import type { TreeEvent } from "./apply.js";
import type { TreeEventKind } from "./event-archive.js";

export type DecodedTreeEvent =
  | { event: undefined }
  | {
      event: TreeEvent;
      /** Which contract event it was; `event` alone does not tell a borrow from a repay. */
      kind: TreeEventKind;
      encNote?: string;
      /** A borrow/repay's keeper note, [eph_x, eph_y, ct0, ct1, ct2] (#212). */
      keeperNote?: bigint[];
    };

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
    keeper_note?: Uint8Array[];
  };
  if (name === "insert_leaf") {
    if (!v.commitment || v.leaf_index === undefined) return { event: undefined };
    return {
      event: { kind: "insert", commitment: toBig(v.commitment), leafIndex: Number(v.leaf_index), newRoot },
      kind: "insert",
    };
  }
  if (!v.new_commitment) return { event: undefined };
  const encNote = v.enc_note && v.enc_note.length > 0 ? Buffer.from(v.enc_note).toString("hex") : undefined;
  const keeperNote = Array.isArray(v.keeper_note) && v.keeper_note.length === 5 ? v.keeper_note.map(toBig) : undefined;
  return {
    event: { kind: "update", newCommitment: toBig(v.new_commitment), newRoot },
    kind: name,
    ...(encNote ? { encNote } : {}),
    ...(keeperNote ? { keeperNote } : {}),
  };
}

/**
 * Re-encodes an event from `getEvents` as the base64 `xdr.ContractEvent` the
 * contract emitted, for the archive's `raw_xdr` (#264).
 */
export function encodeRawTreeEvent(raw: { topic: unknown[]; value: unknown }, contractId: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Address, xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  return new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: Address.fromString(contractId).toScAddress().contractId(),
    type: xdr.ContractEventType.contract(),
    body: new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({ topics: raw.topic as Xdr.ScVal[], data: raw.value as Xdr.ScVal }),
    ),
  }).toXDR("base64");
}
