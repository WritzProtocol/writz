/**
 * Authorization check for POST /insert-commitment (GHSA-wqp4-3573-552v,
 * GHSA-prw2-j3jx-43qh): the endpoint used to accept any commitment from any
 * caller and sign the admin-only `insert_commitment` call on their behalf.
 * An unauthenticated third party could race a victim's own pending deposit,
 * consuming it with a garbage recovery note before the victim's browser got
 * there.
 *
 * The caller must now submit `authTxXdr`: a transaction, never submitted to
 * the network, whose only purpose is to be signed - source account =
 * `depositor`, one `manageData(INSERT_COMMITMENT_DATA_NAME, commitment)`
 * operation. Verifying it proves the caller holds the depositor's private
 * key and intends to authorize inserting exactly this commitment (the same
 * "sign a throwaway transaction" pattern SEP-10 uses for auth challenges,
 * chosen because Stellar wallets generally sign transaction XDR, not
 * arbitrary messages - see WalletProvider's `signTransaction`).
 *
 * That alone isn't enough: nothing stops an attacker from signing a
 * throwaway transaction with their *own* key, naming the *victim's*
 * commitment. `lookupDepositor` closes that gap by reading the real
 * `DepositEvent` the `deposit()` call emitted on-chain - the caller's claimed
 * depositor must match who actually deposited.
 *
 * @stellar/stellar-sdk is lazily require()'d, not statically imported - its
 * CJS build require()s an ESM-only @noble/hashes file that ts-jest's
 * CommonJS loader can't parse (same constraint documented in
 * repay-watcher/poller.ts). Deferring the import keeps this file loadable,
 * and its verification logic testable, under Jest.
 */

export const INSERT_COMMITMENT_DATA_NAME = "writz-insert-commitment";

export class InsertAuthError extends Error {}

export interface VerifyInsertAuthDeps {
  networkPassphrase: string;
  /** Looks up the real depositor address for a commitment from the actual
   * on-chain DepositEvent - never trust a caller-supplied depositor without
   * this. Returns undefined if no matching event was found (e.g. too old
   * for the RPC's retention window, or the deposit never happened). */
  lookupDepositor: (commitmentHex: string) => Promise<string | undefined>;
}

/**
 * Verifies `authTxXdr` genuinely authorizes inserting `commitmentHex`,
 * signed by that commitment's real on-chain depositor. Throws
 * `InsertAuthError` (safe to return to the caller as-is) on any failure.
 */
export async function verifyInsertAuth(
  authTxXdr: string,
  commitmentHex: string,
  deps: VerifyInsertAuthDeps,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");

  let tx: InstanceType<typeof sdk.Transaction>;
  try {
    tx = new sdk.Transaction(authTxXdr, deps.networkPassphrase);
  } catch {
    throw new InsertAuthError("authTxXdr is not a valid signed transaction envelope");
  }

  if (tx.operations.length !== 1) {
    throw new InsertAuthError("authTxXdr must contain exactly one operation");
  }
  const op = tx.operations[0];
  if (op.type !== "manageData" || op.name !== INSERT_COMMITMENT_DATA_NAME) {
    throw new InsertAuthError(
      `authTxXdr's operation must be manageData("${INSERT_COMMITMENT_DATA_NAME}", <commitment>)`,
    );
  }
  const value = op.value;
  if (!value || Buffer.from(value).toString("hex").toLowerCase() !== commitmentHex.toLowerCase()) {
    throw new InsertAuthError("authTxXdr does not authorize this exact commitment");
  }

  const depositor = tx.source;
  const hash = tx.hash();
  let signedByItsOwnSource: boolean;
  try {
    const keypair = sdk.Keypair.fromPublicKey(depositor);
    signedByItsOwnSource = tx.signatures.some((sig) => keypair.verify(hash, sig.signature()));
  } catch {
    throw new InsertAuthError("authTxXdr's source account is not a valid Stellar address");
  }
  if (!signedByItsOwnSource) {
    throw new InsertAuthError("authTxXdr is not validly signed by its own source account");
  }

  const realDepositor = await deps.lookupDepositor(commitmentHex);
  if (!realDepositor) {
    throw new InsertAuthError(
      "no on-chain DepositEvent found for this commitment - it may not have been deposited, " +
        "or is too old for the RPC's event retention window",
    );
  }
  if (realDepositor !== depositor) {
    throw new InsertAuthError("authTxXdr's source account is not this commitment's real depositor");
  }
}

/** Minimal surface of `rpc.Server` this module needs - narrowed so tests can
 * pass a plain mock instead of a real RPC connection. */
export interface DepositEventsServer {
  getLatestLedger(): Promise<{ sequence: number }>;
  getEvents(request: {
    filters: { type: "contract"; contractIds: string[] }[];
    startLedger: number;
  }): Promise<{ events: { topic: unknown[]; value: unknown }[] }>;
}

// Soroban RPC only retains events for a rolling window; a pending deposit
// not yet inserted is expected to be recent, so one day of ledgers (5s
// close time) is generous headroom without scanning the whole chain.
const LOOKBACK_LEDGERS = 17_280;

/**
 * Real implementation of `VerifyInsertAuthDeps["lookupDepositor"]`: scans
 * recent `commitment-tree` contract events for a `deposit` topic matching
 * `commitmentHex` and returns the `depositor` field from its event value.
 *
 * Decoding a multi-field, non-topic contractevent payload (`depositor`,
 * `txid`, `nullifier`, `enc_note`) via `scValToNative` has not been
 * exercised against a real deployed event as of this change - the shape is
 * expected to be a plain object keyed by field name (standard Soroban SDK
 * struct encoding), but this should be confirmed against a live testnet
 * deposit before relying on it in production.
 */
export async function lookupDepositorOnChain(
  server: DepositEventsServer,
  contractId: string,
  commitmentHex: string,
): Promise<string | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");

  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - LOOKBACK_LEDGERS);
  const { events } = await server.getEvents({
    filters: [{ type: "contract", contractIds: [contractId] }],
    startLedger,
  });

  const target = commitmentHex.toLowerCase();
  for (const event of events) {
    const topic0 = event.topic[0] ? (sdk.scValToNative(event.topic[0] as never) as string) : undefined;
    if (topic0 !== "deposit") continue;
    const topicCommitment = event.topic[1]
      ? Buffer.from(sdk.scValToNative(event.topic[1] as never) as Uint8Array).toString("hex")
      : undefined;
    if (topicCommitment !== target) continue;

    const data = sdk.scValToNative(event.value as never) as { depositor?: string };
    if (data.depositor) return data.depositor;
  }
  return undefined;
}
