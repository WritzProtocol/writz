/**
 * Liquidation proofs for the ZK keeper (#212). The witness is the position's
 * liq_key, nonce, amounts and timelock, all read from its keeper note, plus
 * its Merkle path from the leaf store - never the owner's secret.
 *
 * Artifacts: relayer/circuits/liquidation.wasm and liquidation_final.zkey,
 * from the same trusted setup as the `Liquidation` key on zk-verifier.
 */
import path from "path";
import { groth16 } from "snarkjs";
import { computePath, computeRoot } from "../merkle.js";
import { toContractProof, type ContractProof } from "../insert-prover.js";
import type { StoredKeeperPosition } from "../leaf-store.js";

const CIRCUITS_DIR = process.env["INSERT_CIRCUIT_DIR"] ?? path.resolve(__dirname, "../../circuits");
export const LIQUIDATION_WASM = path.join(CIRCUITS_DIR, "liquidation.wasm");
export const LIQUIDATION_ZKEY = path.join(CIRCUITS_DIR, "liquidation_final.zkey");

export function buildLiquidationInput(
  leaves: bigint[],
  p: StoredKeeperPosition,
  priceStroopsPerBtc: bigint,
  thresholdBp: bigint,
): Record<string, unknown> {
  const { pathElements, pathIndices } = computePath(leaves, p.leafIndex);
  return {
    collateral_satoshis: p.collateralSats.toString(),
    debt_stroops: p.debtStroops.toString(),
    liq_key: p.liqKey.toString(),
    nonce: p.nonce.toString(),
    timelock_height: String(p.timelockHeight),
    path_elements: pathElements.map(String),
    path_indices: pathIndices.map(String),
    merkle_root: computeRoot(leaves).toString(),
    btc_price_stroops_per_btc: priceStroopsPerBtc.toString(),
    liquidation_threshold_bp: thresholdBp.toString(),
  };
}

const fe = (dec: string) => Buffer.from(BigInt(dec).toString(16).padStart(64, "0"), "hex");

export async function proveLiquidation(
  input: Record<string, unknown>,
): Promise<{ proof: ContractProof; publicSignals: Buffer[] }> {
  // singleThread: snarkjs's worker pool crashes Bun, which the relayer runs on.
  const { proof, publicSignals } = await groth16.fullProve(
    input,
    LIQUIDATION_WASM,
    LIQUIDATION_ZKEY,
    undefined,
    {},
    { singleThread: true },
  );
  return { proof: toContractProof(proof), publicSignals: publicSignals.map(fe) };
}
