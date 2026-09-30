import { Client } from "@/lib/contracts/generated";
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { config, requireContract } from "@/config";

/**
 * Typed client for the `commitment-tree` contract, built on the generated
 * bindings (see `packages/commitment-tree`). Only read-only helpers are exposed
 * here; write methods (deposit/borrow/repay) will be added with wallet signing.
 */

/** Null account used only as the simulation source for read-only calls. */
const READ_ONLY_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function getClient(): Client {
  return new Client({
    contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: READ_ONLY_SOURCE,
  });
}

function bytesToHex(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** Current Poseidon Merkle root of the commitment tree, as a hex string. */
export async function getMerkleRoot(): Promise<string> {
  const { result } = await getClient().get_merkle_root();
  return bytesToHex(result);
}

export interface PoolState {
  /** Total USDC supplied to the pool, in stroops (7 decimals). */
  totalSupplied: bigint;
  /** Total USDC currently borrowed, in stroops. */
  totalBorrowed: bigint;
  /** Liquidity available to borrow (`supplied - borrowed`), in stroops. */
  available: bigint;
}

/** Pool accounting from `get_pool_state`, which returns `(supplied, borrowed)`. */
export async function getPoolState(): Promise<PoolState> {
  const { result } = await getClient().get_pool_state();
  const [totalSupplied, totalBorrowed] = result;
  return {
    totalSupplied,
    totalBorrowed,
    available: totalSupplied - totalBorrowed,
  };
}

/** A lender's supplied balance (stroops) from `get_supply_balance`. */
export async function getSupplyBalance(lender: string): Promise<bigint> {
  const { result } = await getClient().get_supply_balance({ lender });
  return result;
}

// Soroban RPC only retains events for a rolling window; a position being
// released is expected to have deposited recently enough to still be
// borrowable, so one day of ledgers (5s close time) is generous headroom.
const DEPOSIT_EVENT_LOOKBACK_LEDGERS = 17_280;

/** Minimal surface of `rpc.Server` this lookup needs - narrowed so tests can
 * pass a plain mock instead of a real RPC connection. */
export interface DepositEventsServer {
  getLatestLedger(): Promise<{ sequence: number }>;
  getEvents(request: {
    filters: { type: "contract"; contractIds: string[] }[];
    startLedger: number;
  }): Promise<{ events: { topic: unknown[]; value: unknown }[] }>;
}

/**
 * Looks up the real Bitcoin txid (internal byte order - `sha256d(raw_tx)`,
 * matching `bitcoin-spv::verify_transaction`'s own computation, NOT the
 * reversed display order Esplora/`position.txid` use) that deposited
 * `commitmentHex`, by scanning recent on-chain `DepositEvent`s. Used by
 * `/api/cosign` to bind a release PSBT's input to the real deposit behind
 * the commitment being released (GHSA-9j8g-prh5-jhhj). Returns `undefined`
 * if no matching event is found within the lookback window.
 */
export async function lookupDepositTxid(
  commitmentHex: string,
  server: DepositEventsServer = new rpc.Server(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://"),
  }),
  contractId: string = requireContract(config.contracts.commitmentTree, "commitment-tree"),
): Promise<Buffer | undefined> {
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - DEPOSIT_EVENT_LOOKBACK_LEDGERS);

  const { events } = await server.getEvents({
    filters: [{ type: "contract", contractIds: [contractId] }],
    startLedger,
  });

  const target = commitmentHex.toLowerCase();
  for (const event of events) {
    const topic0 = event.topic[0] ? (scValToNative(event.topic[0] as never) as string) : undefined;
    if (topic0 !== "deposit") continue;
    const topicCommitment = event.topic[1]
      ? Buffer.from(scValToNative(event.topic[1] as never) as Uint8Array).toString("hex")
      : undefined;
    if (topicCommitment !== target) continue;

    const data = scValToNative(event.value as never) as { txid?: Uint8Array };
    if (data.txid) return Buffer.from(data.txid);
  }
  return undefined;
}
