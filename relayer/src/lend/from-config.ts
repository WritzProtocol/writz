/**
 * The Stellar RPC client and the writz-lend position-event index, built once
 * per process from the relayer's configuration and shared by the routes that
 * read lending state (GET /deposit-status, GET /timeline), so one walk of the
 * event window serves both.
 *
 * Built on first use: @stellar/stellar-sdk is required lazily (see
 * ../repay-watcher/poller.ts), and a relayer without WRITZ_LEND_ID never needs it.
 */
import { config } from "../config.js";
import { PositionEventIndex, type DepositEventsServer, type LedgerEntriesServer } from "./deposit-reads.js";
import type { TransactionLookupServer } from "./deposit-submission.js";

/** How long one refresh of the index is shared across callers. */
export const INDEX_FRESH_MS = 5_000;

export type LendRpcServer = DepositEventsServer & LedgerEntriesServer & TransactionLookupServer;

let server: LendRpcServer | undefined;
let index: PositionEventIndex | undefined;

export function lendRpcServer(): LendRpcServer {
  if (!server) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rpc } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
    server = new rpc.Server(config.stellarRpcUrl, {
      allowHttp: config.stellarRpcUrl.startsWith("http://"),
    }) as unknown as LendRpcServer;
  }
  return server;
}

export function positionEventIndex(): PositionEventIndex {
  index ??= new PositionEventIndex({ server: lendRpcServer(), contractId: config.writzLendId, freshForMs: INDEX_FRESH_MS });
  return index;
}
