import { Buffer } from "buffer";
import { Client } from "@/lib/contracts/generated";
import { config, requireContract } from "@/config";
import { proveBorrowRepay } from "@/lib/prover";
import { simulateWithRetry } from "./submit";
import {
  FIELD_PRIME,
  computeCommitment,
  computeNullifier,
  positionKeys,
  seedToField,
  deriveNonce,
  deriveViewingKey,
  sealNote,
  bytesToHex,
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

export interface RepayResult {
  txHash?: string;
  updated: Position;
}

/**
 * Repay USDC debt. Same `borrow_repay` circuit as borrow but `is_borrow = 0` and
 * the repay amount encoded as the BN254 field negation (`p − amount`). Keys are
 * derived from the session seed; the recovery note for the new (lower-debt)
 * state is sealed and emitted on-chain.
 */
export async function repay(params: {
  position: Position;
  amountStroops: bigint;
  repayer: string;
  seed: Uint8Array;
  signTransaction: SignTransaction;
}): Promise<RepayResult> {
  const { position, amountStroops, repayer, seed, signTransaction } = params;

  const collateral = BigInt(position.collateralSats);
  const oldDebt = BigInt(position.debtStroops);
  const f = seedToField(seed);
  const { secret, nonce } = positionKeys(seed, position);
  const newVersion = position.version + 1;
  const newNonce = deriveNonce(f, position.index, newVersion);

  const commitment = computeCommitment(collateral, oldDebt, secret, nonce);
  const commitmentHex = commitment.toString(16).padStart(64, "0");

  const { root, pathElements, pathIndices } = await fetchMerklePath(commitmentHex, position.leafIndex);

  // Repay amount encoded as the BN254 field negation of the delta.
  const delta = (FIELD_PRIME - amountStroops) % FIELD_PRIME;

  const { proof, publicSignals } = await proveBorrowRepay({
    collateral_satoshis: collateral.toString(),
    old_debt_stroops: oldDebt.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
    new_nonce: newNonce.toString(),
    path_elements: pathElements,
    path_indices: pathIndices.map(String),
    old_root: root,
    delta_stroops: delta.toString(),
    is_borrow: "0",
    btc_price_stroops_per_btc: config.btcPriceStroops,
    min_ratio_bp: MIN_RATIO_BP,
  });

  const newDebt = oldDebt - amountStroops;
  const encNote = sealNote(
    {
      index: position.index,
      version: newVersion,
      collateralSats: collateral.toString(),
      debtStroops: newDebt.toString(),
    },
    deriveViewingKey(seed).publicKey,
  );

  const client = new Client({
    contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: repayer,
  });

  const tx = await simulateWithRetry(() =>
    client.repay({
      repayer,
      zk_proof: proof,
      public_signals: publicSignals,
      enc_note: Buffer.from(encNote),
    }),
  );
  const sent = await tx.signAndSend({ signTransaction });

  const newCommitment = computeCommitment(collateral, newDebt, secret, newNonce);
  const updated: Position = {
    ...position,
    id: newCommitment.toString(),
    debtStroops: newDebt.toString(),
    version: newVersion,
    commitment: newCommitment.toString(),
    nullifier: computeNullifier(secret, newNonce).toString(),
    status: newDebt === 0n ? "closed" : "active",
  };
  removePosition(position.owner, position.id);
  savePosition(updated);

  if (position.leafIndex !== undefined && config.services.relayerUrl) {
    const syncRes = await fetch(`${config.services.relayerUrl}/update-leaf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leafIndex: position.leafIndex,
        newCommitment: newCommitment.toString(16).padStart(64, "0"),
        encNote: bytesToHex(encNote),
      }),
    }).catch(() => null);
    if (!syncRes || !syncRes.ok) {
      throw new Error(
        "Repaid on-chain, but failed to sync the relayer leaf store — resync the relayer before the next operation.",
      );
    }
  }

  return { txHash: sent.sendTransactionResponse?.hash, updated };
}
