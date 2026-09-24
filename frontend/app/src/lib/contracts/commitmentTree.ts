import { Client } from "@/lib/contracts/generated";
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
