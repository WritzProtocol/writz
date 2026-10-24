import { Client } from "@/lib/contracts/generated";
import { config, requireContract } from "@/config";

/**
 * Read helpers for the `commitment-tree` contract, built on the generated
 * bindings (see `packages/commitment-tree`). Only the Lend tab's pool reads
 * remain here: borrowing runs on `writz-lend` (see `writzLend.ts`).
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
