import { TransactionBuilder } from "@stellar/stellar-sdk";
import { Server as RpcServer, Api, BasicSleepStrategy } from "@stellar/stellar-sdk/rpc";
import { config } from "@/config";
import { MOCK_XDR_SENTINEL, earnApi, settleMockTx } from "@/lib/earn/api";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

/**
 * Earn flows: deposit USDC into the Writz DeFindex vault and withdraw it.
 *
 * Three parties, and the split matters:
 *   1. The relayer builds the unsigned transaction (it holds the DeFindex API
 *      key; the browser must never see it).
 *   2. The connected wallet signs it - Privy embedded or Stellar Wallets Kit,
 *      the `signTransaction` from `WalletProvider` covers both.
 *   3. The browser submits to Soroban RPC and waits for the ledger.
 *
 * Nothing here is custodial: the relayer cannot move the user's USDC, and the
 * dfTokens land in the user's own account.
 */

export interface EarnTxResult {
  /** Ledger transaction hash, or null in mock mode. */
  txHash: string | null;
}

/**
 * A wallet-level user rejection. Every wallet words this differently, so the
 * flow raises one canonical error and `humanizeError` handles the rest.
 */
export const SIGNATURE_REJECTED = "SignatureRejected";

/**
 * Every wallet words a user rejection differently, and none of them use an
 * error code:
 *   Freighter  "User declined access", "The user rejected this request."
 *   xBull      "User rejected the request"
 *   Albedo     "Action canceled by the user"
 *   Rabet      "User rejected"
 *   Lobstr     "User rejected the request"
 *   Privy      "User rejected request", "User closed the modal"
 *
 * Matching on wording is unavoidable, so it is split by how much each word
 * proves. "Rejected", "declined" and "denied" only ever describe a decision,
 * so they stand alone. "Cancelled", "dismissed" and "closed" also describe
 * things that break on their own ("the connection was closed", "request
 * cancelled" from an aborted fetch), so they count only next to the actor who
 * would have done it deliberately. Privy signs over the network, so a dropped
 * connection mid-signing is a real case, and telling someone they declined
 * when the wallet actually broke sends them to the wrong fix.
 */
export function isUserRejection(message: string): boolean {
  const decision = /\b(reject(ed|s|ing)?|declin(e|ed|es|ing)|denied)\b/i;
  const ambiguous = /\b(cancel(ed|led|s)?|dismiss(ed)?|closed)\b/i;
  const actor = /\b(user|you|modal|popup|window|prompt|request)\b/i;
  return decision.test(message) || (ambiguous.test(message) && actor.test(message));
}

async function signAndSubmit(
  xdr: string,
  signTransaction: SignTransaction,
): Promise<string> {
  let signedTxXdr: string;
  try {
    ({ signedTxXdr } = await signTransaction(xdr));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A rejected signature is a normal outcome, not a failure worth surfacing
    // raw. Anything else is a real wallet error and passes straight through.
    throw isUserRejection(message) ? new Error(SIGNATURE_REJECTED) : e;
  }

  const server = new RpcServer(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://"),
  });
  const signed = TransactionBuilder.fromXDR(signedTxXdr, config.networkPassphrase);
  const sent = await server.sendTransaction(signed);

  // sendTransaction reports one of PENDING | DUPLICATE | TRY_AGAIN_LATER |
  // ERROR. Only the first two mean the transaction is in the network's hands
  // and worth polling for; the other two must not fall through to polling, or
  // the user waits out the whole window to be told NOT_FOUND.
  if (sent.status === "ERROR") {
    throw new Error(
      `Transaction rejected by the network: ${JSON.stringify(sent.errorResult)}`,
    );
  }
  if (sent.status === "TRY_AGAIN_LATER") {
    throw new Error("SubmissionThrottled");
  }

  // pollTransaction defaults to 5 attempts one second apart. A Soroban ledger
  // closes about every 5 seconds, so the default window can expire before the
  // transaction has had a chance to land, and a perfectly good deposit gets
  // reported as failed. 30 seconds matches the patience in `submit.ts`.
  const final = await server.pollTransaction(sent.hash, {
    attempts: 30,
    sleepStrategy: BasicSleepStrategy,
  });

  if (final.status === Api.GetTransactionStatus.NOT_FOUND) {
    // Distinct from a failure on purpose: the transaction is signed, submitted
    // and may still land. Telling the user it failed would be a lie, and would
    // invite them to deposit a second time.
    throw new Error("ConfirmationTimedOut");
  }
  if (final.status !== Api.GetTransactionStatus.SUCCESS) {
    // The vault's own ContractError variant name is in here when the failure
    // came from the contract, which is what humanizeError matches on.
    // Only FAILED is left here, and a failed response always carries the
    // result XDR: the vault's own ContractError variant name is inside it.
    throw new Error(`Transaction failed on-chain: ${String(final.resultXdr)}`);
  }
  return sent.hash;
}

/** Deposit `amountStroops` of USDC (7 decimals) into the vault. */
export async function depositToVault(params: {
  amountStroops: bigint;
  caller: string;
  signTransaction: SignTransaction;
}): Promise<EarnTxResult> {
  const { amountStroops, caller, signTransaction } = params;
  const { xdr } = await earnApi().buildDeposit({ caller, amountStroops });

  if (xdr === MOCK_XDR_SENTINEL) {
    settleMockTx(caller);
    return { txHash: null };
  }
  return { txHash: await signAndSubmit(xdr, signTransaction) };
}

/** Withdraw `amountStroops` of USDC (7 decimals) from the vault. */
export async function withdrawFromVault(params: {
  amountStroops: bigint;
  caller: string;
  signTransaction: SignTransaction;
}): Promise<EarnTxResult> {
  const { amountStroops, caller, signTransaction } = params;
  const { xdr } = await earnApi().buildWithdraw({ caller, amountStroops });

  if (xdr === MOCK_XDR_SENTINEL) {
    settleMockTx(caller);
    return { txHash: null };
  }
  return { txHash: await signAndSubmit(xdr, signTransaction) };
}
