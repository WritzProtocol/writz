import { Client } from "@/lib/contracts/generated";
import { Buffer } from "buffer";
import { Account, TransactionBuilder, Operation } from "@stellar/stellar-sdk";
import { config, requireContract } from "@/config";
import { proveDeposit } from "@/lib/prover";
import { getCommitmentForTxid, isCommitmentPending } from "@/lib/contracts/commitmentTree";
import { simulateWithRetry } from "./submit";
import {
  computeCommitment,
  computeNullifier,
  seedToField,
  deriveSecret,
  deriveNonce,
  deriveViewingKey,
  sealNote,
  bytesToHex,
  getPosition,
  savePosition,
  type Position,
} from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import type { Emit } from "@/lib/flow/engine";
import { locks } from "@/lib/flow/lock";
import { pendingDeposits, planResume, type PendingDeposit } from "@/lib/flow/pendingDeposit";
import { activity, type TxStatus } from "@/lib/flow/pendingTx";
import { getTxStatus, signAndSubmit, TxTimedOutError } from "@/lib/flow/stellarTx";

// Must match the contract's `min_deposit_satoshis` config (set at initialization).
const MIN_DEPOSIT_SATS = "10000"; // 0.0001 BTC

// Must match relayer/src/insert-auth.ts's INSERT_COMMITMENT_DATA_NAME.
const INSERT_COMMITMENT_DATA_NAME = "writz-insert-commitment";

const POLL_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Builds and signs a throwaway transaction (never submitted) authorizing
 * `/insert-commitment` to insert exactly this commitment. The relayer
 * verifies the signature is genuinely `depositor`'s and cross-checks it
 * against the real on-chain DepositEvent before signing the admin-only
 * insertion - without this, any network-reachable caller could hijack a
 * pending deposit (GHSA-wqp4-3573-552v, GHSA-prw2-j3jx-43qh). The sequence
 * number is a dummy "0": this transaction is only ever inspected for its
 * signature, source account, and operation, never broadcast.
 */
async function buildInsertAuthTx(
  depositor: string,
  commitmentHex: string,
  signTransaction: SignTransaction,
): Promise<string> {
  const account = new Account(depositor, "0");
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.manageData({
        name: INSERT_COMMITMENT_DATA_NAME,
        value: Buffer.from(commitmentHex, "hex"),
      }),
    )
    .setTimeout(30)
    .build();
  const { signedTxXdr } = await signTransaction(tx.toXDR());
  return signedTxXdr;
}

async function sha256d(bytes: ArrayBuffer): Promise<Buffer> {
  const h1 = await crypto.subtle.digest("SHA-256", bytes);
  const h2 = await crypto.subtle.digest("SHA-256", h1);
  return Buffer.from(h2);
}

/**
 * Split the internal-order txid (SHA256d of raw tx) into the two 128-bit
 * halves the deposit circuit expects as `btc_txid_lo` / `btc_txid_hi`.
 */
async function txidParts(rawTxHex: string): Promise<{ lo: string; hi: string }> {
  const raw = Buffer.from(rawTxHex, "hex");
  const buf = await sha256d(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const hi = BigInt("0x" + buf.subarray(0, 16).toString("hex")).toString();
  const lo = BigInt("0x" + buf.subarray(16, 32).toString("hex")).toString();
  return { lo, hi };
}

const toHex64 = (n: bigint) => n.toString(16).padStart(64, "0");

export interface SpvBundle {
  txid: string;
  rawTxNoWitness: string;
  confirmations: number;
  sorobanArgs: {
    headers: string[];
    merkle_proof: string[];
    tx_index: number;
    raw_tx: string;
    min_confirmations: number;
  };
}

export type SpvPoll =
  | { ready: true; bundle: SpvBundle }
  | { ready: false; confirmations: number; required: number | null };

export type OutputLookup = { vout: number; sats: bigint } | "unseen" | "no_output";

export interface RegisterInput {
  pd: PendingDeposit;
  bundle: SpvBundle;
  seed: Uint8Array;
  signTransaction: SignTransaction;
  emit: Emit;
  onProved: (p: { commitment: bigint; nullifier: bigint }) => void;
  onSigned: (hash: string) => void;
  onDropped: () => void;
}

/** Network edges of the deposit flow, swappable as one object. */
export interface DepositDeps {
  pollSpv(txid: string): Promise<SpvPoll>;
  findOutput(txid: string, address: string): Promise<OutputLookup>;
  getCommitment(btcTxid: string): Promise<string | null>;
  isCommitmentPending(commitmentHex: string): Promise<boolean>;
  getTxStatus(hash: string): Promise<TxStatus>;
  /** Proves, signs and submits `deposit()`; resolves once confirmed. */
  register(input: RegisterInput): Promise<{ hash: string }>;
  insert(input: {
    depositor: string;
    commitmentHex: string;
    encNote: Uint8Array;
    signTransaction: SignTransaction;
  }): Promise<{ leafIndex?: number }>;
  lookupLeafIndex(commitmentHex: string): Promise<number | undefined>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function relayerUrl(): string {
  const url = config.services.relayerUrl;
  if (!url) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured");
  return url;
}

/** The relayer endpoint for a deposit's SPV bundle, at the confirmation count this app requires. */
export function spvProofUrl(base: string, txid: string): string {
  // The relayer accepts 1..20 confirmations.
  const confirmations = Math.min(20, Math.max(1, config.bitcoin.minConfirmations));
  return `${base}/spv-proof/${txid}?confirmations=${confirmations}`;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error("Aborted"));
    });
  });
}

async function realRegister(input: RegisterInput): Promise<{ hash: string }> {
  const { pd, bundle, seed, signTransaction, emit } = input;
  const collateralSats = BigInt(pd.sats);
  const { lo, hi } = await txidParts(bundle.rawTxNoWitness);

  const f = seedToField(seed);
  const secret = deriveSecret(f, pd.positionIndex);
  const nonce = deriveNonce(f, pd.positionIndex, 0);

  emit({ type: "proving" });
  const { proof, publicSignals } = await proveDeposit({
    collateral_satoshis: collateralSats.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
    btc_txid_lo: lo,
    btc_txid_hi: hi,
    min_deposit_satoshis: MIN_DEPOSIT_SATS,
  });

  // Public signals (deposit circuit): commitment[0], nullifier[1], ...
  const commitment = BigInt("0x" + publicSignals[0].toString("hex"));
  if (commitment !== computeCommitment(collateralSats, 0n, secret, nonce)) {
    throw new Error("Commitment mismatch - circuit output does not match local computation.");
  }
  input.onProved({ commitment, nullifier: computeNullifier(secret, nonce) });

  const encNote = sealDepositNote(seed, pd.positionIndex, collateralSats);
  const client = new Client({
    contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: pd.stellarAddress,
  });
  const { sorobanArgs } = bundle;
  emit({ type: "preparing", step: "building" });
  const tx = await simulateWithRetry(() =>
    client.deposit({
      depositor: pd.stellarAddress,
      headers: sorobanArgs.headers.map((h) => Buffer.from(h, "hex")),
      merkle_proof_btc: sorobanArgs.merkle_proof.map((h) => Buffer.from(h, "hex")),
      tx_index: sorobanArgs.tx_index,
      raw_tx: Buffer.from(sorobanArgs.raw_tx, "hex"),
      zk_proof: proof,
      public_signals: publicSignals,
      enc_note: Buffer.from(encNote),
    }),
  );
  const { hash } = await signAndSubmit(tx, {
    signTransaction,
    emit,
    onSigned: input.onSigned,
    onDropped: input.onDropped,
  });
  return { hash };
}

export const depositDeps: DepositDeps = {
  async pollSpv(txid) {
    const res = await fetch(spvProofUrl(relayerUrl(), txid));
    if (res.status === 404 || res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { available?: number; requested?: number };
      return { ready: false, confirmations: body.available ?? 0, required: body.requested ?? null };
    }
    if (!res.ok) throw new Error(`Relayer error ${res.status}`);
    return { ready: true, bundle: (await res.json()) as SpvBundle };
  },
  async findOutput(txid, address) {
    let res: Response;
    try {
      res = await fetch(`${config.bitcoin.apiUrl}/tx/${txid}`);
    } catch {
      return "unseen";
    }
    if (!res.ok) return "unseen";
    const tx = (await res.json()) as { vout: { scriptpubkey_address?: string; value: number }[] };
    const vout = tx.vout.findIndex((o) => o.scriptpubkey_address === address);
    return vout === -1 ? "no_output" : { vout, sats: BigInt(tx.vout[vout].value) };
  },
  getCommitment: getCommitmentForTxid,
  isCommitmentPending,
  getTxStatus,
  register: realRegister,
  async insert({ depositor, commitmentHex, encNote, signTransaction }) {
    const authTxXdr = await buildInsertAuthTx(depositor, commitmentHex, signTransaction);
    const res = await fetch(`${relayerUrl()}/insert-commitment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commitment: commitmentHex, encNote: bytesToHex(encNote), authTxXdr }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(`Merkle insertion failed: ${body.error ?? res.status}`);
    }
    return (await res.json().catch(() => ({}))) as { leafIndex?: number };
  },
  async lookupLeafIndex(commitmentHex) {
    const res = await fetch(`${relayerUrl()}/merkle-path?commitment=${commitmentHex}`).catch(() => null);
    if (!res?.ok) return undefined;
    const body = (await res.json().catch(() => ({}))) as { leafIndex?: number };
    return body.leafIndex;
  },
  sleep: abortableSleep,
};

function sealDepositNote(seed: Uint8Array, index: number, collateralSats: bigint): Uint8Array {
  return sealNote(
    { index, version: 0, collateralSats: collateralSats.toString(), debtStroops: "0" },
    deriveViewingKey(seed).publicKey,
  );
}

function registeringPosition(pd: PendingDeposit, commitment: string, nullifier: string): Position {
  return {
    id: commitment,
    owner: pd.stellarAddress,
    txid: pd.btcTxid,
    collateralSats: pd.sats,
    debtStroops: "0",
    index: pd.positionIndex,
    version: 0,
    commitment,
    nullifier,
    status: "registering",
    createdAt: pd.createdAt,
    btcPubkey: pd.btcPubkey,
    timelockHeight: pd.timelockHeight,
    vout: pd.vout,
    stellarTxHash: pd.stellarTxHash,
  };
}

// ── Starting a deposit ────────────────────────────────────────────────────

interface StartContext {
  owner: string;
  p2wsh: string;
  btcPubkey: string;
  usedIndices: number[];
  emit: Emit;
}

function newPending(
  ctx: StartContext,
  btcTxid: string,
  sats: bigint,
  positionIndex: number,
  vout?: number,
): PendingDeposit {
  const now = Date.now();
  return {
    btcTxid,
    sats: sats.toString(),
    vout,
    p2wsh: ctx.p2wsh,
    btcPubkey: ctx.btcPubkey,
    timelockHeight: config.bitcoin.timelockHeight,
    stellarAddress: ctx.owner,
    positionIndex,
    step: vout === undefined ? "sent" : "confirming",
    createdAt: now,
    updatedAt: now,
  };
}

/** Sends BTC from the wallet and persists the PendingDeposit the moment the wallet returns a txid. */
export async function startDepositBySending(
  ctx: StartContext & { sats: bigint; send: (to: string, sats: number) => Promise<string> },
): Promise<PendingDeposit> {
  const index = await locks().reservePositionIndex(ctx.owner, ctx.usedIndices);
  ctx.emit({ type: "awaiting_signature", wallet: "bitcoin" });
  let txid: string;
  try {
    txid = await ctx.send(ctx.p2wsh, Number(ctx.sats));
  } catch (e) {
    await locks().releasePositionIndex(ctx.owner, index);
    throw e;
  }
  return pendingDeposits.save(newPending(ctx, txid.toLowerCase(), ctx.sats, index));
}

/** Starts from a txid the user pasted. Amount and output index come from Bitcoin, never from the form. */
export async function startDepositFromTxid(
  ctx: StartContext & { txid: string; deps?: DepositDeps },
): Promise<PendingDeposit> {
  const deps = ctx.deps ?? depositDeps;
  const txid = ctx.txid.trim().toLowerCase();
  ctx.emit({ type: "preparing", step: "locating_output" });
  const out = await deps.findOutput(txid, ctx.p2wsh);
  if (out === "unseen") throw new Error("Bitcoin hasn't seen this transaction yet.");
  if (out === "no_output") throw new Error("This transaction does not pay your deposit address.");
  const index = await locks().reservePositionIndex(ctx.owner, ctx.usedIndices);
  return pendingDeposits.save(newPending(ctx, txid, out.sats, index, out.vout));
}

// ── Resuming and driving a deposit ────────────────────────────────────────

export type TrackResult =
  | { status: "ready"; pd: PendingDeposit }
  | { status: "registering"; position: Position }
  | { status: "active"; position: Position };

async function withRetry<T>(fn: () => Promise<T>, deps: DepositDeps, signal?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted || attempt >= 3) throw e;
      await deps.sleep(2_000 * attempt, signal);
    }
  }
}

async function locateOutput(
  pd: PendingDeposit,
  emit: Emit,
  deps: DepositDeps,
  signal?: AbortSignal,
): Promise<PendingDeposit> {
  emit({ type: "preparing", step: "locating_output" });
  for (;;) {
    const out = await deps.findOutput(pd.btcTxid, pd.p2wsh);
    if (out === "no_output") throw new Error("This transaction does not pay your deposit address.");
    if (out !== "unseen") {
      return pendingDeposits.update(pd.stellarAddress, {
        vout: out.vout,
        sats: out.sats.toString(),
        step: "confirming",
      })!;
    }
    await deps.sleep(POLL_MS, signal);
  }
}

/** Waits for the relayer's SPV bundle with no deadline; the caller stops it with `signal`. */
async function waitForConfirmations(
  pd: PendingDeposit,
  emit: Emit,
  deps: DepositDeps,
  signal?: AbortSignal,
): Promise<SpvBundle> {
  let failures = 0;
  let required = pd.required ?? config.bitcoin.minConfirmations;
  for (;;) {
    try {
      const poll = await deps.pollSpv(pd.btcTxid);
      failures = 0;
      if (poll.ready) return poll.bundle;
      required = poll.required ?? required;
      emit({ type: "btc_confirmations", confirmations: poll.confirmations, required });
      if (poll.confirmations !== pd.confirmations || required !== pd.required) {
        pd = pendingDeposits.update(pd.stellarAddress, {
          confirmations: poll.confirmations,
          required,
          step: "confirming",
        }) ?? pd;
      }
      await deps.sleep(POLL_MS, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      failures++;
      emit({ type: "relayer_unreachable", required });
      await deps.sleep(Math.min(POLL_MS * 2 ** (failures - 1), MAX_BACKOFF_MS), signal);
    }
  }
}

async function finalizeDeposit(
  pd: PendingDeposit,
  commitmentHex: string,
  deps: DepositDeps,
): Promise<Position> {
  const id = BigInt("0x" + commitmentHex).toString();
  const existing = getPosition(pd.stellarAddress, id);
  const base = existing ?? registeringPosition(pd, id, pd.nullifier ?? "");
  const leafIndex = base.leafIndex ?? (await deps.lookupLeafIndex(commitmentHex));
  const position: Position = { ...base, status: "active", leafIndex };
  savePosition(position);
  pendingDeposits.clear(pd.stellarAddress);
  await locks().releasePositionIndex(pd.stellarAddress, pd.positionIndex);
  return position;
}

function ensureRegistering(pd: PendingDeposit, commitmentHex: string): Position {
  const id = BigInt("0x" + commitmentHex).toString();
  const existing = getPosition(pd.stellarAddress, id);
  if (existing) return existing;
  const position = registeringPosition(pd, id, pd.nullifier ?? "");
  savePosition(position);
  pendingDeposits.update(pd.stellarAddress, { step: "registering" });
  return position;
}

/**
 * Brings a saved deposit up to date with the chain and drives it as far as
 * it can go without a signature: locate the output, wait for confirmations,
 * or wait out a submitted Stellar deposit.
 */
export async function trackDeposit(
  owner: string,
  opts: { emit: Emit; signal?: AbortSignal; deps?: DepositDeps },
): Promise<TrackResult> {
  const deps = opts.deps ?? depositDeps;
  const { emit, signal } = opts;
  for (;;) {
    let pd = pendingDeposits.load(owner);
    if (!pd) throw new Error("No deposit in progress.");

    const commitmentForTxid = await withRetry(() => deps.getCommitment(pd!.btcTxid), deps, signal);
    const commitmentPending = commitmentForTxid
      ? await withRetry(() => deps.isCommitmentPending(commitmentForTxid), deps, signal)
      : null;
    const stellarTx =
      pd.stellarTxHash && !commitmentForTxid
        ? await deps.getTxStatus(pd.stellarTxHash).catch(() => "NOT_FOUND" as const)
        : null;

    const plan = planResume(pd, { commitmentForTxid, commitmentPending, stellarTx }, Date.now());
    switch (plan.action) {
      case "finalize":
        return { status: "active", position: await finalizeDeposit(pd, plan.commitment, deps) };
      case "conflict":
        throw new Error("DuplicateDeposit");
      case "insert":
        return { status: "registering", position: ensureRegistering(pd, plan.commitment) };
      case "await_stellar":
        emit({ type: "submitted", hash: plan.hash });
        await deps.sleep(5_000, signal);
        continue;
      case "locate_output":
        await locateOutput(pd, emit, deps, signal);
        continue;
      case "wait_confirmations": {
        if (pd.stellarTxHash) {
          activity.removeTx(owner, pd.stellarTxHash);
          pd = pendingDeposits.update(owner, { stellarTxHash: undefined, stellarSubmittedAt: undefined })!;
        }
        await waitForConfirmations(pd, emit, deps, signal);
        pd = pendingDeposits.update(owner, { step: "ready" })!;
        emit({ type: "ready" });
        return { status: "ready", pd };
      }
    }
  }
}

/** Adds a deposited commitment to the tree. Retries only the relayer insert, never `deposit()`. */
export async function finishDeposit(params: {
  position: Position;
  seed: Uint8Array;
  signTransaction: SignTransaction;
  emit: Emit;
  deps?: DepositDeps;
}): Promise<Position> {
  const { position, seed, signTransaction, emit } = params;
  const deps = params.deps ?? depositDeps;
  const commitmentHex = toHex64(BigInt(position.commitment));
  emit({ type: "post_processing", step: "insert" });
  try {
    let leafIndex: number | undefined;
    if (await deps.isCommitmentPending(commitmentHex)) {
      const encNote = sealDepositNote(seed, position.index, BigInt(position.collateralSats));
      ({ leafIndex } = await deps.insert({
        depositor: position.owner,
        commitmentHex,
        encNote,
        signTransaction,
      }));
    } else {
      leafIndex = await deps.lookupLeafIndex(commitmentHex);
    }
    const active: Position = { ...position, status: "active", leafIndex };
    savePosition(active);
    const pd = pendingDeposits.load(position.owner);
    if (pd && pd.btcTxid === position.txid) {
      pendingDeposits.clear(position.owner);
      await locks().releasePositionIndex(position.owner, pd.positionIndex);
    }
    emit({ type: "settled", hash: position.stellarTxHash });
    return active;
  } catch (error) {
    emit({ type: "needs_attention", action: "finish_deposit", error, hash: position.stellarTxHash });
    throw error;
  }
}

/**
 * Proves and submits the Stellar deposit for a confirmed BTC transaction,
 * then inserts it. Checks the chain first so a resumed deposit never calls
 * `deposit()` twice.
 */
export async function registerDeposit(params: {
  owner: string;
  seed: Uint8Array;
  signTransaction: SignTransaction;
  emit: Emit;
  signal?: AbortSignal;
  deps?: DepositDeps;
}): Promise<Position> {
  const { owner, seed, signTransaction, emit, signal } = params;
  const deps = params.deps ?? depositDeps;

  const tracked = await trackDeposit(owner, { emit, signal, deps });
  if (tracked.status === "active") {
    emit({ type: "settled", hash: tracked.position.stellarTxHash });
    return tracked.position;
  }
  if (tracked.status === "registering") {
    return finishDeposit({ position: tracked.position, seed, signTransaction, emit, deps });
  }

  let pd = tracked.pd;
  emit({ type: "preparing", step: "building" });
  const bundle = await waitForConfirmations(pd, emit, deps, signal);

  let hash: string;
  try {
    ({ hash } = await deps.register({
      pd,
      bundle,
      seed,
      signTransaction,
      emit,
      onProved: ({ commitment, nullifier }) => {
        pd = pendingDeposits.update(owner, {
          commitment: commitment.toString(),
          nullifier: nullifier.toString(),
        })!;
      },
      onSigned: (h) => {
        pd = pendingDeposits.update(owner, {
          stellarTxHash: h,
          stellarSubmittedAt: Date.now(),
          step: "submitted",
        })!;
        activity.addTx(owner, { hash: h, kind: "deposit", createdAt: Date.now() });
      },
      onDropped: () => {
        if (pd.stellarTxHash) activity.removeTx(owner, pd.stellarTxHash);
        pd = pendingDeposits.update(owner, {
          stellarTxHash: undefined,
          stellarSubmittedAt: undefined,
          step: "ready",
        })!;
      },
    }));
  } catch (e) {
    if (e instanceof TxTimedOutError) emit({ type: "timed_out", hash: e.hash });
    throw e;
  }

  activity.removeTx(owner, hash);
  pd = pendingDeposits.update(owner, { step: "registering" })!;
  const position = registeringPosition(pd, pd.commitment!, pd.nullifier!);
  savePosition(position);
  return finishDeposit({ position, seed, signTransaction, emit, deps });
}
