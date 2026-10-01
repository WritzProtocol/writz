import { createJsonStore, type JsonStore } from "./storage";

/**
 * A deposit that has sent BTC but is not yet a usable position. Written the
 * moment `sendBtc` returns, keyed by Stellar address, so a reload or a closed
 * tab never orphans locked BTC.
 */
export type DepositStep = "sent" | "confirming" | "ready" | "submitted" | "registering";

export interface PendingDeposit {
  /** Bitcoin txid, display (Esplora) byte order. */
  btcTxid: string;
  /** Satoshis paid to the lock address. A hint until `vout` is set, then read from the chain. */
  sats: string;
  /** Output index paying the lock address, read from the chain. */
  vout?: number;
  /** The P2WSH lock address. */
  p2wsh: string;
  btcPubkey: string;
  timelockHeight: number;
  stellarAddress: string;
  positionIndex: number;
  step: DepositStep;
  confirmations?: number;
  required?: number;
  /** Set once proven, before the Stellar deposit is signed. */
  commitment?: string;
  nullifier?: string;
  stellarTxHash?: string;
  stellarSubmittedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export function createPendingDepositStore(store: JsonStore<PendingDeposit> = createJsonStore("writz.pendingDeposit.")) {
  return {
    load: (owner: string) => store.read(owner),
    snapshot: (owner: string) => store.snapshot(owner),
    subscribe: store.subscribe,
    save(pd: PendingDeposit, now = Date.now()): PendingDeposit {
      const next = { ...pd, updatedAt: now };
      store.write(pd.stellarAddress, next);
      return next;
    },
    update(owner: string, patch: Partial<PendingDeposit>, now = Date.now()): PendingDeposit | null {
      const current = store.read(owner);
      if (!current) return null;
      const next = { ...current, ...patch, updatedAt: now };
      store.write(owner, next);
      return next;
    },
    clear: (owner: string) => store.write(owner, null),
  };
}

export const pendingDeposits = createPendingDepositStore();

/** Signed Soroban transactions expire after the SDK's 300 s timeout; one more minute covers ledger lag. */
export const STELLAR_TX_TTL_MS = 360_000;

/** What the chain says about a pending deposit, read on load. */
export interface DepositChainView {
  /** `get_commitment(txid)` as hex, or null when the txid was never deposited. */
  commitmentForTxid: string | null;
  /** `is_commitment_pending(commitment)`, read only when a commitment exists. */
  commitmentPending: boolean | null;
  /** `getTransaction(stellarTxHash)`, read only when a hash is stored. */
  stellarTx: "SUCCESS" | "FAILED" | "NOT_FOUND" | null;
}

export type ResumeAction =
  | { action: "locate_output" }
  | { action: "wait_confirmations" }
  | { action: "await_stellar"; hash: string }
  | { action: "insert"; commitment: string }
  | { action: "finalize"; commitment: string }
  | { action: "conflict"; commitment: string };

/**
 * Where a pending deposit resumes, skipping every step the chain shows as
 * done. Never plans a second `deposit()` when the txid already has a
 * commitment on chain.
 */
export function planResume(
  pd: PendingDeposit,
  chain: DepositChainView,
  now: number,
): ResumeAction {
  const onChain = chain.commitmentForTxid?.toLowerCase() ?? null;
  if (onChain) {
    const mine = pd.commitment ? BigInt(pd.commitment).toString(16).padStart(64, "0") : null;
    if (mine !== onChain) return { action: "conflict", commitment: onChain };
    return chain.commitmentPending === false
      ? { action: "finalize", commitment: onChain }
      : { action: "insert", commitment: onChain };
  }

  if (pd.stellarTxHash && chain.stellarTx !== "FAILED") {
    const young = now - (pd.stellarSubmittedAt ?? pd.updatedAt) < STELLAR_TX_TTL_MS;
    // SUCCESS with no commitment yet is RPC read lag, not a missing deposit.
    if (chain.stellarTx === "SUCCESS" || young) {
      return { action: "await_stellar", hash: pd.stellarTxHash };
    }
  }

  if (pd.vout === undefined) return { action: "locate_output" };
  return { action: "wait_confirmations" };
}
