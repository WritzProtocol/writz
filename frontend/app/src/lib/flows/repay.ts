import { internalTxid, readPosition, writzLendClient, type ChainPosition } from "@/lib/contracts/writzLend";
import type { Position } from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import type { Emit } from "@/lib/flow/engine";
import { simulateWritzLend } from "./submit";
import { submitPositionTx } from "./positionTx";
import { requireOpenPosition } from "./borrow";

export interface RepayResult {
  txHash?: string;
  updated: Position;
}

/**
 * Follow-up repayments a full repay may take. Interest accrues every ledger
 * and `repay` refuses more than the debt, so a full repay is priced at the
 * latest ledger and can leave the few ledgers of interest it took to land.
 * That remainder is a handful of stroops, too small to grow between ledgers,
 * so one more repayment of exactly it closes the loan.
 */
const MAX_REMAINDER_REPAYS = 2;
const READ_ATTEMPTS = 10;
const READ_RETRY_MS = 2_000;

export interface RepayDeps {
  read(txid: string): Promise<ChainPosition | null>;
  sleep(ms: number): Promise<void>;
}

const defaultDeps: RepayDeps = {
  read: readPosition,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** What a repay of `amountStroops` should send: the whole debt when it covers it, never more. */
export function repayPlan(
  amountStroops: bigint,
  shownDebtStroops: bigint,
  chainDebtStroops: bigint,
): { amount: bigint; full: boolean } {
  // "Repay all" sends the debt shown when the panel rendered; interest since then belongs to it too.
  const full = amountStroops >= shownDebtStroops || amountStroops >= chainDebtStroops;
  return { amount: full ? chainDebtStroops : amountStroops, full };
}

/** Reads the position until the chain reflects a transaction that landed in `ledger`. */
async function readAfter(txid: string, ledger: number | undefined, before: bigint, deps: RepayDeps): Promise<ChainPosition | null> {
  for (let attempt = 0; ; attempt++) {
    const chain = await deps.read(txid);
    const caughtUp =
      !chain || chain.status !== "active" || (ledger !== undefined ? chain.ledger >= ledger : chain.storedDebtStroops < before);
    if (caughtUp || attempt >= READ_ATTEMPTS) return chain;
    await deps.sleep(READ_RETRY_MS);
  }
}

/**
 * Repay USDC debt: `writz-lend.repay(repayer, txid, amount)`. Repaying the
 * whole debt closes the position on chain, which is what lets Writz co-sign
 * the BTC release.
 */
export async function repay(params: {
  position: Position;
  amountStroops: bigint;
  repayer: string;
  signTransaction: SignTransaction;
  emit?: Emit;
  deps?: RepayDeps;
}): Promise<RepayResult> {
  const { position, amountStroops, repayer, signTransaction, emit } = params;
  const deps = params.deps ?? defaultDeps;

  emit?.({ type: "preparing", step: "reading" });
  let chain = await requireOpenPosition(position.txid, repayer, deps.read);
  const plan = repayPlan(amountStroops, BigInt(position.debtStroops), chain.debtStroops);

  const client = writzLendClient(repayer);
  const send = async (amount: bigint, current: Position, keepOpen: boolean) => {
    emit?.({ type: "preparing", step: "building" });
    const tx = await simulateWritzLend(() =>
      client.repay({ repayer, txid: internalTxid(position.txid), usdc_amount: amount }),
    );
    const left = chain.debtStroops > amount ? chain.debtStroops - amount : 0n;
    const updated: Position = { ...current, debtStroops: left.toString(), status: left === 0n ? "closed" : "active" };
    const sent = await submitPositionTx({ kind: "repay", tx, position: current, updated, signTransaction, emit, keepOpen });
    return { ...sent, updated };
  };

  let result = await send(plan.amount, position, plan.full);
  if (!plan.full) return { txHash: result.hash, updated: result.updated };

  for (let i = 0; ; i++) {
    const after = await readAfter(position.txid, result.ledger, chain.storedDebtStroops, deps);
    if (!after || after.status !== "active" || after.debtStroops === 0n || i >= MAX_REMAINDER_REPAYS) {
      const updated: Position =
        after && after.status === "active"
          ? { ...result.updated, debtStroops: after.debtStroops.toString(), status: "active" }
          : { ...result.updated, debtStroops: "0", status: "closed" };
      emit?.({ type: "settled", hash: result.hash });
      return { txHash: result.hash, updated };
    }
    chain = after;
    result = await send(after.debtStroops, result.updated, true);
  }
}
