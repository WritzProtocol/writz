import { Client } from "commitment-tree";
import { config, requireContract } from "@/config";
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

const MIN_RATIO_BP = "15000"; // 150% — must match contract's min_collateral_ratio_bp

interface MerklePathResponse {
  root: string;
  pathElements: string[];
  pathIndices: number[];
  leafIndex: number;
}

async function fetchMerklePath(commitmentHex: string, leafIndex?: number): Promise<MerklePathResponse> {
  const relayerUrl = config.services.relayerUrl;
  if (!relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured");
  const qs =
    leafIndex !== undefined
      ? `?leafIndex=${leafIndex}&commitment=${commitmentHex}`
      : `?commitment=${commitmentHex}`;
  const res = await fetch(`${relayerUrl}/merkle-path${qs}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Merkle path unavailable: ${body.error ?? res.status}`);
  }
  return res.json() as Promise<MerklePathResponse>;
}

export interface BorrowResult {
  txHash?: string;
  updated: Position;
}

/**
 * Borrow USDC against a position: fetch the real Merkle path from the server,
 * generate the borrow_repay ZK proof in-browser, submit `borrow()` signed by
 * the Stellar wallet, then update the local position (new debt, nonce, commitment).
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

  const commitment = computeCommitment(collateral, oldDebt, secret, nonce);
  const commitmentHex = commitment.toString(16).padStart(64, "0");

  // Fetch the real Merkle path from the server. Pass leafIndex so the server can
  // look up by position (not by value) — the commitment rotates on every borrow,
  // so value-based lookup would fail from the second borrow onward.
  const { root, pathElements, pathIndices } = await fetchMerklePath(commitmentHex, position.leafIndex);

  const { proof, publicSignals } = await proveBorrowRepay({
    collateral_satoshis: collateral.toString(),
    old_debt_stroops: oldDebt.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
    new_nonce: newNonce.toString(),
    path_elements: pathElements,
    path_indices: pathIndices.map(String),
    old_root: root,
    delta_stroops: amountStroops.toString(),
    is_borrow: "1",
    // Price read from config (env: NEXT_PUBLIC_BTC_PRICE_STROOPS).
    // Must match the on-chain oracle — the contract rejects proofs with a
    // different value (CommitmentTreeError::PriceMismatch = #12).
    btc_price_stroops_per_btc: config.btcPriceStroops,
    min_ratio_bp: MIN_RATIO_BP,
  });

  const client = new Client({
    contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: borrower,
  });

  const tx = await simulateWithRetry(() =>
    client.borrow({ borrower, zk_proof: proof, public_signals: publicSignals }),
  );
  const sent = await tx.signAndSend({ signTransaction });

  const newDebt = oldDebt + amountStroops;
  const newCommitment = computeCommitment(collateral, newDebt, secret, newNonce);
  const updated: Position = {
    ...position,
    id: newCommitment.toString(),
    debtStroops: newDebt.toString(),
    nonce: newNonce.toString(),
    commitment: newCommitment.toString(),
    nullifier: computeNullifier(secret, newNonce).toString(),
    status: "active",
  };
  removePosition(position.owner, position.id);
  savePosition(updated);

  // Keep the server-side leaf store in sync so subsequent borrows/repays by any
  // user get correct sibling values in their Merkle paths.
  if (position.leafIndex !== undefined && config.services.relayerUrl) {
    fetch(`${config.services.relayerUrl}/update-leaf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leafIndex: position.leafIndex,
        newCommitment: newCommitment.toString(16).padStart(64, "0"),
      }),
    }).catch(() => {
      // Non-fatal: the next merkle-path call will provide the correct commitment
      // via leafIndex, so the path remains correct even if this update is lost.
    });
  }

  return { txHash: sent.sendTransactionResponse?.hash, updated };
}
