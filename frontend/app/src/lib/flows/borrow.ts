import { internalTxid, readPosition, writzLendClient, type ChainPosition } from "@/lib/contracts/writzLend";
import type { Position } from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import type { Emit } from "@/lib/flow/engine";
import { simulateWritzLend } from "./submit";
import { submitPositionTx } from "./positionTx";

/** The open position `owner` can act on, read fresh from `writz-lend`. Throws the contract's own error names. */
export async function requireOpenPosition(
  txid: string,
  owner: string,
  read: (txid: string) => Promise<ChainPosition | null> = readPosition,
): Promise<ChainPosition> {
  const chain = await read(txid);
  if (!chain) throw new Error("PositionNotFound");
  if (chain.depositor !== owner) throw new Error("Unauthorized");
  if (chain.status !== "active") throw new Error("PositionNotActive");
  return chain;
}

export interface BorrowResult {
  txHash?: string;
  updated: Position;
}

/**
 * Borrow USDC against a position: `writz-lend.borrow(borrower, txid, amount)`.
 * The contract checks the 150% limit against the live oracle price and the
 * debt with interest, and pays the USDC to `borrower`.
 */
export async function borrow(params: {
  position: Position;
  amountStroops: bigint;
  borrower: string;
  signTransaction: SignTransaction;
  emit?: Emit;
}): Promise<BorrowResult> {
  const { position, amountStroops, borrower, signTransaction, emit } = params;

  emit?.({ type: "preparing", step: "reading" });
  const chain = await requireOpenPosition(position.txid, borrower);

  emit?.({ type: "preparing", step: "building" });
  const client = writzLendClient(borrower);
  const tx = await simulateWritzLend(() =>
    client.borrow({ borrower, txid: internalTxid(position.txid), usdc_amount: amountStroops }),
  );
  const updated: Position = {
    ...position,
    debtStroops: (chain.debtStroops + amountStroops).toString(),
    status: "active",
  };
  const { hash } = await submitPositionTx({ kind: "borrow", tx, position, updated, signTransaction, emit });
  return { txHash: hash, updated };
}
