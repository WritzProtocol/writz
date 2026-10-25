import type { contract, Transaction } from "@stellar/stellar-sdk";

/**
 * Leaves only the inclusion fee on `tx.built`, so `signAndSend()` adds the
 * simulated resource fee once. In @stellar/stellar-sdk 16,
 * `AssembledTransaction.sign()` rebuilds the transaction with
 * `fee: built.fee`, which already includes the resource fee, and the builder
 * then adds it again. The bid becomes inclusion + 2 x resource fee: the
 * account pays for twice the fee, and past ~214.7 XLM of resource fee the
 * total no longer fits the uint32 fee field, so `sign()` throws before
 * anything is sent. On testnet on 2026-10-25 a `publish_release_psbt` needed
 * ~267 XLM, so the co-signed release was never published. The app carries the
 * same fix (frontend/app/src/lib/flow/stellarTx.ts). Upstream fixed this in
 * 17.3.0 (stellar/js-stellar-sdk#1808); remove this when the relayer moves to it.
 *
 * `sign()` takes the resource fee from the simulation, not from `built`, so the
 * Soroban data is dropped here too, which also makes a second call a no-op.
 *
 * The SDK is required lazily, like the keeper and the repay poller do, so
 * importing this module does not load it at module scope. `require` can hand
 * back the SDK's CJS build while the caller's `AssembledTransaction` comes from
 * the ESM build, and `sign()` checks `instanceof Transaction`; rebuilding with
 * `built.constructor` keeps the caller's own class either way.
 */
export function bidInclusionFeeOnly<T>(tx: contract.AssembledTransaction<T>): void {
  const built = tx.built;
  if (!built) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const envelope = xdr.TransactionEnvelope.fromXDR(built.toXDR(), "base64");
  if (envelope.switch() !== xdr.EnvelopeType.envelopeTypeTx()) return;
  const inner = envelope.v1().tx();
  if (inner.ext().switch() !== 1) return;
  const resourceFee = inner.ext().sorobanData().resourceFee().toBigInt();
  const inclusionFee = BigInt(inner.fee()) - resourceFee;
  if (inclusionFee <= 0n) return;
  inner.fee(Number(inclusionFee));
  inner.ext(new xdr.TransactionExt(0));
  const SameTransaction = built.constructor as new (envelope: string, networkPassphrase: string) => Transaction;
  tx.built = new SameTransaction(envelope.toXDR("base64"), built.networkPassphrase);
}
