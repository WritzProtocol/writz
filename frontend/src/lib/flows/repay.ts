import { Client } from "commitment-tree";
import { config, requireContract } from "@/config";
import { singleLeafPath } from "@/lib/merkle";
import { proveBorrowRepay } from "@/lib/prover";
import { simulateWithRetry } from "./submit";
import {
  FIELD_PRIME,
  computeCommitment,
  computeNullifier,
  randomFieldElement,
  removePosition,
  savePosition,
  type Position,
} from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

const BTC_PRICE_STROOPS_PER_BTC = "600000000000"; // $60,000 testnet stub
const MIN_RATIO_BP = "15000"; // 150%

export interface RepayResult {
  txHash?: string;
  updated: Position;
}

/**
 * Repay USDC debt on a position. Uses the same `borrow_repay` circuit as borrow,
 * but with `is_borrow = 0` and the repay amount encoded as a field negation
 * (`p - amount`), which is how the contract recovers the amount to collect.
 */
export async function repay(params: {
  position: Position;
  amountStroops: bigint;
  repayer: string;
  signTransaction: SignTransaction;
}): Promise<RepayResult> {
  const { position, amountStroops, repayer, signTransaction } = params;

  const collateral = BigInt(position.collateralSats);
  const oldDebt = BigInt(position.debtStroops);
  const secret = BigInt(position.secret);
  const nonce = BigInt(position.nonce);
  const newNonce = randomFieldElement();

  const commitment = computeCommitment(collateral, oldDebt, secret, nonce);
  const { root, pathElements, pathIndices } = singleLeafPath(commitment);

  // Repay amount is encoded as the BN254 field negation of the delta.
  const delta = (FIELD_PRIME - amountStroops) % FIELD_PRIME;

  const { proof, publicSignals } = await proveBorrowRepay({
    collateral_satoshis: collateral.toString(),
    old_debt_stroops: oldDebt.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
    new_nonce: newNonce.toString(),
    path_elements: pathElements.map(String),
    path_indices: pathIndices.map(String),
    old_root: root.toString(),
    delta_stroops: delta.toString(),
    is_borrow: "0",
    btc_price_stroops_per_btc: BTC_PRICE_STROOPS_PER_BTC,
    min_ratio_bp: MIN_RATIO_BP,
  });

  const client = new Client({
    contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: repayer,
  });

  const tx = await simulateWithRetry(() =>
    client.repay({ repayer, zk_proof: proof, public_signals: publicSignals }),
  );
  const sent = await tx.signAndSend({ signTransaction });

  const newDebt = oldDebt - amountStroops;
  const updated: Position = {
    ...position,
    id: computeCommitment(collateral, newDebt, secret, newNonce).toString(),
    debtStroops: newDebt.toString(),
    nonce: newNonce.toString(),
    commitment: computeCommitment(collateral, newDebt, secret, newNonce).toString(),
    nullifier: computeNullifier(secret, newNonce).toString(),
    status: newDebt === 0n ? "closed" : "active",
  };
  removePosition(position.owner, position.id);
  savePosition(updated);

  return { txHash: sent.sendTransactionResponse?.hash, updated };
}
