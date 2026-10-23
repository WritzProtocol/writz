/**
 * Reads the commitment tree's root and next leaf index at one ledger (#265).
 *
 * `get_merkle_root()` and `get_next_leaf_index()` are two simulations that
 * can land on different ledgers, so this reads the storage they return in
 * a single `getLedgerEntries` call instead: `MerkleRoot` (persistent) and
 * `NextLeafIndex` (in the instance), both as of the response's
 * `latestLedger`.
 *
 * Deliberately does not statically import `@stellar/stellar-sdk` at module
 * scope (see `../repay-watcher/poller.ts` for why).
 */
import { computeRoot } from "../merkle.js";

export interface TreeHead {
  root: bigint;
  nextLeafIndex: number;
  /** The ledger both values were read at. */
  ledger: number;
}

export async function readTreeHead(server: unknown, contractId: string): Promise<TreeHead> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Address, xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const contract = Address.fromString(contractId).toScAddress();
  const key = (k: import("@stellar/stellar-sdk").xdr.ScVal) =>
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({ contract, key: k, durability: xdr.ContractDataDurability.persistent() }),
    );
  const rootKey = key(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("MerkleRoot")]));
  const instanceKey = key(xdr.ScVal.scvLedgerKeyContractInstance());

  const res = await (server as import("@stellar/stellar-sdk").rpc.Server).getLedgerEntries(rootKey, instanceKey);
  const find = (k: typeof rootKey) => res.entries.find((e) => e.key.toXDR("base64") === k.toXDR("base64"));

  const instance = find(instanceKey);
  if (!instance) throw new Error(`contract ${contractId} has no instance on this network`);
  const stored = instance.val.contractData().val().instance().storage() ?? [];
  const next = stored.find((e) => e.key().switch().name === "scvVec" && e.key().vec()?.[0]?.sym().toString() === "NextLeafIndex");

  // The constructor writes MerkleRoot, so a missing entry only happens
  // before it ran; the contract then answers with the empty tree's root.
  const rootEntry = find(rootKey);
  const root = rootEntry
    ? BigInt("0x" + Buffer.from(rootEntry.val.contractData().val().bytes()).toString("hex"))
    : computeRoot([]);

  return { root, nextLeafIndex: next ? next.val().u32() : 0, ledger: res.latestLedger };
}
