import { TransactionBuilder } from "@stellar/stellar-sdk";
import { Server as RpcServer, Api } from "@stellar/stellar-sdk/rpc";
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
 * Matching on wording is unavoidable. It is kept narrow on purpose: a false
 * positive would tell the user they declined when the wallet actually broke.
 */
export function isUserRejection(message: string): boolean {
  return /\b(reject(ed|s|ing)?|declin(e|ed|es)|denied|cancel(ed|led)?|dismissed|closed)\b/i.test(
    message,
  );
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

  if (sent.status === "ERROR") {
    throw new Error(`Transaction rejected by the network: ${JSON.stringify(sent.errorResult)}`);
  }

  const final = await server.pollTransaction(sent.hash);
  if (final.status !== Api.GetTransactionStatus.SUCCESS) {
    // The vault's own ContractError variant name is in here when the failure
    // came from the contract, which is what humanizeError matches on.
    throw new Error(
      `Transaction failed on-chain: ${
        "resultXdr" in final ? String(final.resultXdr) : final.status
      }`,
    );
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
