import { writzLendClient } from "@/lib/contracts/writzLend";
import { simulateWithRetry } from "./submit";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import type { Emit } from "@/lib/flow/engine";
import { submitTrackedTx } from "./positionTx";

/**
 * Lender-side flows: supply USDC to the pool and withdraw it later.
 *
 * Plain authenticated contract calls. The USDC token transfer happens inside the contract
 * (`supply_usdc` pulls from the lender; `withdraw_supply` pays back), and the
 * wallet authorizes it as part of signing the transaction.
 */

export interface LendResult {
  txHash?: string;
}

/** Supply USDC to the pool. `amountStroops` is USDC in 7-decimal stroops. */
export async function supply(params: {
  amountStroops: bigint;
  supplier: string;
  signTransaction: SignTransaction;
  emit?: Emit;
}): Promise<LendResult> {
  const { amountStroops, supplier, signTransaction, emit } = params;
  const client = writzLendClient(supplier);

  const tx = await simulateWithRetry(() =>
    client.supply_usdc({ supplier, amount: amountStroops }),
  );
  const { hash } = await submitTrackedTx({ kind: "supply", owner: supplier, tx, signTransaction, emit });
  return { txHash: hash };
}

/**
 * Withdraw previously supplied USDC. The contract enforces two limits:
 *   - the lender cannot withdraw more than their own balance
 *     (`InsufficientSupply`), and
 *   - the pool must have enough undeployed liquidity (`InsufficientLiquidity`).
 */
export async function withdraw(params: {
  amountStroops: bigint;
  supplier: string;
  signTransaction: SignTransaction;
  emit?: Emit;
}): Promise<LendResult> {
  const { amountStroops, supplier, signTransaction, emit } = params;
  const client = writzLendClient(supplier);

  const tx = await simulateWithRetry(() =>
    client.withdraw_supply({ supplier, amount: amountStroops }),
  );
  const { hash } = await submitTrackedTx({ kind: "withdraw", owner: supplier, tx, signTransaction, emit });
  return { txHash: hash };
}
