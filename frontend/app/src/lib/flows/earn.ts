import { Asset, TransactionBuilder } from "@stellar/stellar-sdk";
import { Server as RpcServer, Api, BasicSleepStrategy } from "@stellar/stellar-sdk/rpc";
import { config } from "@/config";
import { earnApi } from "@/lib/earn/api";
import { verifyVaultTx, type VaultAction } from "@/lib/earn/verifyVaultTx";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import type { Emit } from "@/lib/flow/engine";
import { activity, type PendingTxKind } from "@/lib/flow/pendingTx";
import { asRejection } from "@/lib/wallet/rejection";
import type { SigningIntent } from "@/lib/wallet/intent";

/**
 * Earn flows: deposit USDC into the Writz DeFindex vault and withdraw it.
 *
 * Three parties, and the split matters:
 *   1. The relayer builds the unsigned transaction (it holds the DeFindex API
 *      key; the browser must never see it).
 *   2. The connected wallet signs it - Pollar or Stellar Wallets Kit, the
 *      `signTransaction` from `WalletProvider` covers both.
 *   3. The browser submits to Soroban RPC and waits for the ledger.
 *
 * Before step 2 the app parses the returned transaction and refuses to show it
 * to the wallet unless it is exactly the requested call (`verifyVaultTx`): the
 * caller as source, one operation calling `deposit` or `withdraw` on
 * `config.earn.vaultId` with the requested amount and the caller as `from`, and
 * authorization for that call alone (plus, on a deposit, the vault asset's
 * `transfer` of that amount from the caller to the vault). Whatever the relayer
 * returns, what the wallet is asked to sign moves only the requested amount
 * between the user and the vault, and the dfTokens land in the user's own
 * account.
 */

export interface EarnTxResult {
  /** Ledger transaction hash of the confirmed transaction. */
  txHash: string;
}

async function signAndSubmit(
  xdr: string,
  signTransaction: SignTransaction,
  track: { owner: string; kind: PendingTxKind; intent: SigningIntent; emit?: Emit },
): Promise<string> {
  const { owner, kind, intent, emit } = track;
  emit?.({ type: "awaiting_signature", wallet: "stellar" });
  let signedTxXdr: string;
  try {
    ({ signedTxXdr } = await signTransaction(xdr, { intent }));
  } catch (e) {
    const rejected = asRejection(e, "stellar");
    if (rejected) {
      emit?.({ type: "signature_cancelled", walletName: rejected.walletName });
      throw rejected;
    }
    throw e;
  }

  const server = new RpcServer(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://"),
  });
  const signed = TransactionBuilder.fromXDR(signedTxXdr, config.networkPassphrase);
  const hash = signed.hash().toString("hex");
  activity.addTx(owner, { hash, kind, createdAt: Date.now() });
  emit?.({ type: "submitted", hash });
  const sent = await server.sendTransaction(signed).catch((e: unknown) => {
    activity.removeTx(owner, hash);
    throw e;
  });

  // sendTransaction reports one of PENDING | DUPLICATE | TRY_AGAIN_LATER |
  // ERROR. Only the first two mean the transaction is in the network's hands
  // and worth polling for; the other two must not fall through to polling, or
  // the user waits out the whole window to be told NOT_FOUND.
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    activity.removeTx(owner, hash);
  }
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
    emit?.({ type: "timed_out", hash });
    throw new Error("ConfirmationTimedOut");
  }
  activity.removeTx(owner, hash);
  if (final.status !== Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed on-chain: ${final.resultXdr.toXDR("base64")}`);
  }
  emit?.({ type: "settled", hash });
  return sent.hash;
}

/** The vault asset's Stellar Asset Contract, or "" when the asset is not configured. */
function earnAssetContractId(): string {
  const { code, issuer } = config.earn.asset;
  if (!code || !issuer) return "";
  return new Asset(code, issuer).contractId(config.networkPassphrase);
}

/** Throws before any wallet prompt unless `xdr` is exactly the requested vault call. */
function checkVaultTx(xdr: string, action: VaultAction, caller: string, amountStroops: bigint): void {
  verifyVaultTx({
    xdr,
    networkPassphrase: config.networkPassphrase,
    vaultId: config.earn.vaultId,
    assetContractId: earnAssetContractId(),
    action,
    caller,
    amountStroops,
  });
}

/** Deposit `amountStroops` of USDC (7 decimals) into the vault. */
export async function depositToVault(params: {
  amountStroops: bigint;
  caller: string;
  signTransaction: SignTransaction;
  emit?: Emit;
}): Promise<EarnTxResult> {
  const { amountStroops, caller, signTransaction, emit } = params;
  const { xdr } = await earnApi().buildDeposit({ caller, amountStroops });
  checkVaultTx(xdr, "deposit", caller, amountStroops);
  return {
    txHash: await signAndSubmit(xdr, signTransaction, {
      owner: caller,
      kind: "earn_deposit",
      intent: { kind: "earn.deposit", amount: amountStroops },
      emit,
    }),
  };
}

/** Withdraw `amountStroops` of USDC (7 decimals) from the vault. */
export async function withdrawFromVault(params: {
  amountStroops: bigint;
  caller: string;
  signTransaction: SignTransaction;
  emit?: Emit;
}): Promise<EarnTxResult> {
  const { amountStroops, caller, signTransaction, emit } = params;
  const { xdr } = await earnApi().buildWithdraw({ caller, amountStroops });
  checkVaultTx(xdr, "withdraw", caller, amountStroops);
  return {
    txHash: await signAndSubmit(xdr, signTransaction, {
      owner: caller,
      kind: "earn_withdraw",
      intent: { kind: "earn.withdraw", amount: amountStroops },
      emit,
    }),
  };
}
