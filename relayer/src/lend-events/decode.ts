/**
 * Decodes a `writz-lend` RPC event into an archive row.
 *
 * Every archived event has its subject in the second topic: the position
 * txid, or the supplier's address. Administrative events are not archived, so
 * they decode to null. An event with an archived name that does not have that
 * shape throws: skipping it would leave a silent hole in the record.
 */
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import type { LendEventRow } from "./store.js";

const ARCHIVED = new Set(["deposit", "borrow", "repay", "repay_full", "liquidate", "supply", "withdraw"]);

export interface RawLendEvent {
  id: string;
  ledger: number;
  txHash: string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
}

/** Bytes as hex and integers as decimal strings, so the JSON loses nothing. */
function plain(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

export function encodeRawXdr(event: Pick<RawLendEvent, "topic" | "value">): string {
  return JSON.stringify({
    topic: event.topic.map((t) => t.toXDR("base64")),
    value: event.value.toXDR("base64"),
  });
}

/** The decoded columns of a stored `raw_xdr`, to check them against the row. */
export function decodeRawXdr(rawXdr: string): { name: string; subject: string; data: string } {
  const { topic, value } = JSON.parse(rawXdr) as { topic: string[]; value: string };
  return decodeColumns(
    topic.map((t) => xdr.ScVal.fromXDR(t, "base64")),
    xdr.ScVal.fromXDR(value, "base64"),
  );
}

function decodeColumns(topic: xdr.ScVal[], value: xdr.ScVal) {
  const name = scValToNative(topic[0]!) as string;
  if (topic.length < 2) throw new Error(`${name} event has no subject topic`);
  const subject = plain(scValToNative(topic[1]!));
  if (typeof subject !== "string") throw new Error(`${name} event has an unreadable subject`);
  return { name, subject, data: JSON.stringify(plain(scValToNative(value))) };
}

export function decodeLendEvent(event: RawLendEvent, contractId: string): LendEventRow | null {
  const first = event.topic[0];
  if (!first) throw new Error(`event ${event.id} has no topics`);
  const name = scValToNative(first);
  if (typeof name !== "string" || !ARCHIVED.has(name)) return null;
  return {
    id: event.id,
    contractId,
    ledger: event.ledger,
    txHash: event.txHash,
    ...decodeColumns(event.topic, event.value),
    rawXdr: encodeRawXdr(event),
  };
}
