import { Buffer } from "buffer";
import { Client } from "@/lib/contracts/generated";
import { config, requireContract } from "@/config";
import { simulateWithRetry } from "./submit";
import type { ContractProof } from "@/lib/prover";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

/**
 * Records a position's BTC release on-chain before the protocol co-signs it,
 * by spending the zero-debt leaf's nullifier (GHSA-w4rp-v54x-2cv3,
 * GHSA-hcjf-8vjc-2hfv). Anyone can submit it: the proof needs the position's
 * secret and nonce, so only the owner can produce one.
 */
export async function markReleased(params: {
  proof: ContractProof;
  publicSignals: Buffer[];
  sender: string;
  signTransaction: SignTransaction;
  /** Defaults to the configured commitment-tree; tests pass one explicitly. */
  contractId?: string;
}): Promise<{ txHash?: string }> {
  const { proof, publicSignals, sender, signTransaction } = params;
  const contractId =
    params.contractId ?? requireContract(config.contracts.commitmentTree, "commitment-tree");
  const client = new Client({
    contractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: sender,
  });
  const tx = await simulateWithRetry(() =>
    client.mark_released({ zk_proof: proof, public_signals: publicSignals }),
  );
  const sent = await tx.signAndSend({ signTransaction });
  return { txHash: sent.sendTransactionResponse?.hash };
}
