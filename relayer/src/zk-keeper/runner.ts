/**
 * ZK keeper (#212): liquidates undercollateralized commitment-tree positions
 * without their owners.
 *
 * The tree watcher hands every borrow/repay keeper note to `recordKeeperNote`,
 * which opens it with the keeper's BabyJubJub key and keeps the position's
 * liquidation witness. `runKeeperCycle` then checks each position with debt
 * against the oracle price and, below the liquidation threshold, proves it
 * undercollateralized and calls `liquidate`, paying the debt from the keeper
 * account. The witness is liq_key, not the owner's secret, so the keeper can
 * close a position but never borrow against it or release its BTC.
 *
 * Deliberately does not statically import `@stellar/stellar-sdk` at module
 * scope (see `../repay-watcher/poller.ts` for why).
 */
import { openKeeperNote } from "./babyjub.js";
import { isLiquidatable } from "./health.js";
import { buildLiquidationInput, proveLiquidation } from "./prover.js";
import {
  markKeeperLiquidated,
  readKeeperPositions,
  readLeaves,
  saveKeeperPosition,
  type StoredKeeperPosition,
} from "../leaf-store.js";
import type { ContractProof } from "../insert-prover.js";
import { bidInclusionFeeOnly } from "../soroban-fee.js";
import { withAccountLock } from "../account-lock.js";

export interface KeeperNoteSink {
  (leafIndex: number, commitment: bigint, note: bigint[]): void;
}

/** Returns the sink the tree watcher calls, or undefined when no keeper key is configured. */
export function keeperNoteSink(
  keeperSk: bigint | undefined,
  save: (p: Omit<StoredKeeperPosition, "liquidated">) => void = saveKeeperPosition,
): KeeperNoteSink | undefined {
  if (keeperSk === undefined) return undefined;
  return (leafIndex, commitment, note) => {
    const opened = openKeeperNote(keeperSk, note, commitment);
    if (!opened) {
      // The circuit encrypts to the contract's keeper key, so this means the
      // key was rotated and this process holds the old one.
      console.error(`[zk-keeper] leaf ${leafIndex}: note does not open with this keeper key`);
      return;
    }
    save({ leafIndex, commitment, ...opened });
  };
}

export interface KeeperDeps {
  positions: () => StoredKeeperPosition[];
  leaves: () => bigint[];
  isSpent: (nullifier: bigint) => Promise<boolean>;
  prove: (input: Record<string, unknown>) => Promise<{ proof: ContractProof; publicSignals: Buffer[] }>;
  liquidate: (proof: ContractProof, publicSignals: Buffer[]) => Promise<string | undefined>;
  markLiquidated: (leafIndex: number, commitment: bigint) => void;
  nullifierOf: (p: StoredKeeperPosition) => bigint;
  priceStroopsPerBtc: bigint;
  thresholdBp: bigint;
}

/** One pass over the keeper's positions. Returns the leaves it liquidated. */
export async function runKeeperCycle(deps: KeeperDeps): Promise<number[]> {
  const leaves = deps.leaves();
  const done: number[] = [];
  for (const p of deps.positions()) {
    if (p.liquidated || p.debtStroops === 0n) continue;
    // The leaf moved on (a later borrow/repay whose note this store has not
    // seen yet): the witness no longer matches the tree.
    if (leaves[p.leafIndex] !== p.commitment) continue;
    if (!isLiquidatable(p.collateralSats, p.debtStroops, deps.priceStroopsPerBtc, deps.thresholdBp)) continue;
    // Released, liquidated by someone else, or replaced since.
    if (await deps.isSpent(deps.nullifierOf(p))) {
      deps.markLiquidated(p.leafIndex, p.commitment);
      continue;
    }
    try {
      const input = buildLiquidationInput(leaves, p, deps.priceStroopsPerBtc, deps.thresholdBp);
      const { proof, publicSignals } = await deps.prove(input);
      const hash = await deps.liquidate(proof, publicSignals);
      deps.markLiquidated(p.leafIndex, p.commitment);
      done.push(p.leafIndex);
      console.log(`[zk-keeper] liquidated leaf ${p.leafIndex} (debt ${p.debtStroops} stroops) tx ${hash ?? "?"}`);
    } catch (e) {
      console.error(`[zk-keeper] leaf ${p.leafIndex}: liquidation failed:`, e instanceof Error ? e.message : e);
    }
  }
  return done;
}

export function startZkKeeper(): { stop: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require("../config.js") as typeof import("../config.js");
  if (!config.commitmentTreeId || config.keeperBabyjubSecret === undefined || !config.keeperSecret) {
    console.warn("[zk-keeper] COMMITMENT_TREE_ID, KEEPER_BABYJUB_SECRET and KEEPER_SECRET not all set - ZK keeper disabled");
    return { stop: () => {} };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Keypair, Transaction } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require("commitment-tree") as typeof import("commitment-tree");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { poseidon2 } = require("poseidon-lite") as typeof import("poseidon-lite");

  const keypair = Keypair.fromSecret(config.keeperSecret);
  const keeper = keypair.publicKey();
  const client = new Client({
    contractId: config.commitmentTreeId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.stellarRpcUrl,
    allowHttp: config.stellarRpcUrl.startsWith("http://"),
    publicKey: keeper,
  });
  const hex = (n: bigint) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");
  const deps: KeeperDeps = {
    positions: readKeeperPositions,
    leaves: readLeaves,
    isSpent: async (n) => (await client.is_nullifier_spent({ nullifier: hex(n) })).result,
    prove: proveLiquidation,
    liquidate: async (proof, publicSignals) => {
      // Under the keeper account's lock, in case it is also the account
      // another submitter signs with (see account-lock.ts).
      return withAccountLock(keeper, async () => {
        const tx = await client.liquidate({ keeper, zk_proof: proof, public_signals: publicSignals });
        bidInclusionFeeOnly(tx);
        const sent = await tx.signAndSend({
          signTransaction: async (xdr: string) => {
            const t = new Transaction(xdr, config.networkPassphrase);
            t.sign(keypair);
            return { signedTxXdr: t.toXDR(), signerAddress: keeper };
          },
        });
        return sent.sendTransactionResponse?.hash;
      });
    },
    markLiquidated: markKeeperLiquidated,
    nullifierOf: (p) => poseidon2([p.liqKey, p.nonce]),
    priceStroopsPerBtc: config.btcPriceStroops,
    thresholdBp: config.liquidationThresholdBp,
  };

  let stopped = false;
  void (async () => {
    while (!stopped) {
      try {
        await runKeeperCycle(deps);
      } catch (e) {
        console.error("[zk-keeper] cycle failed:", e instanceof Error ? e.message : e);
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, config.keeperPollIntervalMs));
    }
  })();
  return { stop: () => { stopped = true; } };
}
