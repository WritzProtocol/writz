/// <reference types="bun-types" />
/**
 * Reads the #264 tree event archive as a rebuild source (#265): the local
 * `TREE_EVENTS_SQLITE_PATH`, or any copy of that file.
 *
 * Each event is decoded again from its `raw_xdr`, the event as the contract
 * emitted it, rather than trusted from the decoded columns, and must belong
 * to the contract being rebuilt. The replay and the final root check do the
 * rest, so a copy from anywhere is either proven by the chain or rejected.
 */
import { Database } from "bun:sqlite";
import fs from "fs";
import type { DecodedTreeEvent } from "../tree-watcher/decode.js";
import { RebuildError, type RebuildEvent } from "./rebuild.js";

export function archiveEventsFrom(
  dbPath: string,
  contractId: string,
  decodeEvent: (raw: { topic: unknown[]; value: unknown }) => DecodedTreeEvent,
): () => Iterable<RebuildEvent> {
  return function* () {
    if (!fs.existsSync(dbPath)) throw new RebuildError(`no archive at ${dbPath}`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { StrKey, xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .query<{ id: string; ledger: number; txHash: string; rawXdr: string }, []>(
          "SELECT id, ledger, tx_hash AS txHash, raw_xdr AS rawXdr FROM tree_events ORDER BY ledger, id",
        )
        .iterate();
      for (const row of rows) {
        const at = { id: row.id, ledger: row.ledger, txHash: row.txHash };
        let event;
        try {
          event = xdr.ContractEvent.fromXDR(row.rawXdr, "base64");
        } catch {
          throw new RebuildError("raw_xdr is not a contract event", at);
        }
        const emitter = event.contractId();
        if (!emitter || StrKey.encodeContract(Buffer.from(emitter as unknown as Uint8Array)) !== contractId) {
          throw new RebuildError(`raw_xdr was not emitted by ${contractId}`, at);
        }
        const body = event.body().v0();
        yield { ...at, decoded: decodeEvent({ topic: body.topics(), value: body.data() }) };
      }
    } finally {
      db.close();
    }
  };
}
