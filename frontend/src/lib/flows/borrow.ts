import { Client } from "commitment-tree";
import { config, requireContract } from "@/config";
import { singleLeafPath } from "@/lib/merkle";
import { proveBorrowRepay } from "@/lib/prover";
import { simulateWithRetry } from "./submit";
import {
  computeCommitment,
  computeNullifier,
  randomFieldElement,
  removePosition,
  savePosition,
  type Position,
} from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

// Testnet oracle stub price; must match the on-chain oracle for borrow() to pass.
const BTC_PRICE_STROOPS_PER_BTC = "600000000000"; // $60,000 (7 decimals)
const MIN_RATIO_BP = "15000"; // 150%

export interface BorrowResult {
  txHash?: string;
  updated: Position;
}

/**
 * Borrow USDC against a position: build the Merkle path, generate the
 * borrow_repay proof in the browser, submit `borrow()` signed by the wallet,
 * then update the local position (new debt, nonce, commitment, nullifier).
 */
export async function borrow(params: {
  position: Position;
  amountStroops: bigint;
  borrower: string;
  signTransaction: SignTransaction;
}): Promise<BorrowResult> {
  const { position, amountStroops, borrower, signTransaction } = params;

  const collateral = BigInt(position.collateralSats);
  const oldDebt = BigInt(position.debtStroops);
  const secret = BigInt(position.secret);
  const nonce = BigInt(position.nonce);
  const newNonce = randomFieldElement();

  // Merkle path for this position's current commitment (single-leaf demo tree).
  const commitment = computeCommitment(collateral, oldDebt, secret, nonce);
  const { root, pathElements, pathIndices } = singleLeafPath(commitment);

  const { proof, publicSignals } = await proveBorrowRepay({
    collateral_satoshis: collateral.toString(),
    old_debt_stroops: oldDebt.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
    new_nonce: newNonce.toString(),
    path_elements: pathElements.map(String),
    path_indices: pathIndices.map(String),
    old_root: root.toString(),
    delta_stroops: amountStroops.toString(),
    is_borrow: "1",
    btc_price_stroops_per_btc: BTC_PRICE_STROOPS_PER_BTC,
    min_ratio_bp: MIN_RATIO_BP,
  });

  const client = new Client({
    contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: borrower,
  });

  // Building the tx simulates it; contract errors (e.g. InsufficientLiquidity,
  // RootMismatch) surface here.
  const tx = await simulateWithRetry(() =>
    client.borrow({ borrower, zk_proof: proof, public_signals: publicSignals }),
  );
  const sent = await tx.signAndSend({ signTransaction });

  // Update the local position to reflect the new debt and rotated nonce.
  const newDebt = oldDebt + amountStroops;
  const updated: Position = {
    ...position,
    id: computeCommitment(collateral, newDebt, secret, newNonce).toString(),
    debtStroops: newDebt.toString(),
    nonce: newNonce.toString(),
    commitment: computeCommitment(collateral, newDebt, secret, newNonce).toString(),
    nullifier: computeNullifier(secret, newNonce).toString(),
    status: "active",
  };
  removePosition(position.owner, position.id);
  savePosition(updated);

  return { txHash: sent.sendTransactionResponse?.hash, updated };
}
