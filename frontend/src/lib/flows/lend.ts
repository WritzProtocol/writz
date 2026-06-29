import { Client } from "commitment-tree";
import { config, requireContract } from "@/config";
import { simulateWithRetry } from "./submit";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

/**
 * Lender-side flows: supply USDC to the pool and withdraw it later.
 *
 * Unlike borrow/repay these carry no ZK proof — they are plain authenticated
 * contract calls. The USDC token transfer happens inside the contract
 * (`supply_usdc` pulls from the lender; `withdraw_supply` pays back), and the
 * wallet authorizes it as part of signing the transaction.
 */

function lendClient(supplier: string): Client {
  return new Client({
    contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: supplier,
  });
}

export interface LendResult {
  txHash?: string;
}

/** Supply USDC to the pool. `amountStroops` is USDC in 7-decimal stroops. */
export async function supply(params: {
  amountStroops: bigint;
  supplier: string;
  signTransaction: SignTransaction;
}): Promise<LendResult> {
  const { amountStroops, supplier, signTransaction } = params;
  const client = lendClient(supplier);

  const tx = await simulateWithRetry(() =>
    client.supply_usdc({ supplier, amount: amountStroops }),
  );
  const sent = await tx.signAndSend({ signTransaction });

  return { txHash: sent.sendTransactionResponse?.hash };
}

/**
 * Withdraw previously supplied USDC. The contract enforces two limits:
 *   - the lender cannot withdraw more than their own supplied balance
 *     (`WithdrawExceedsBalance`), and
 *   - the pool must have enough undeployed liquidity (`InsufficientLiquidity`).
 */
export async function withdraw(params: {
  amountStroops: bigint;
  supplier: string;
  signTransaction: SignTransaction;
}): Promise<LendResult> {
  const { amountStroops, supplier, signTransaction } = params;
  const client = lendClient(supplier);

  const tx = await simulateWithRetry(() =>
    client.withdraw_supply({ supplier, amount: amountStroops }),
  );
  const sent = await tx.signAndSend({ signTransaction });

  return { txHash: sent.sendTransactionResponse?.hash };
}
