import { Buffer } from "buffer";
import { depositKeyMessage, parseMessageSignature } from "@/lib/bitcoin/keyProof";
import { config } from "@/config";
import { readPosition, writzLendClient, writzLendId } from "@/lib/contracts/writzLend";
import { simulateWritzLend } from "./submit";
import { syncPosition } from "./discover";
import type { Position } from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import type { Emit } from "@/lib/flow/engine";
import { locks } from "@/lib/flow/lock";
import { pendingDeposits, planResume, type PendingDeposit } from "@/lib/flow/pendingDeposit";
import { activity, type TxStatus } from "@/lib/flow/pendingTx";
import { getTxStatus, signAndSubmit, TxTimedOutError } from "@/lib/flow/stellarTx";
import { fetchTipHeight, findDepositOutput } from "@/lib/bitcoin/timelock";
import { deriveP2WSH } from "@/lib/bitcoin/address";
import { MIN_DEPOSIT_SATS } from "@/lib/borrow/journey";

const POLL_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;

export interface SpvBundle {
  txid: string;
  rawTxNoWitness: string;
  confirmations: number;
  sorobanArgs: {
    block_hash: string;
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

export type DepositLookup = (DepositLock & { vout: number; sats: bigint }) | "unseen" | "no_output";

export interface RegisterInput {
  pd: PendingDeposit;
  bundle: SpvBundle;
  signTransaction: SignTransaction;
  /** Signs a message with the deposit's Bitcoin key; returns base64 (BIP-137). */
  signKeyProof: (message: string) => Promise<string>;
  emit: Emit;
  /** `timelockHeight` is the deposit output's real CLTV height, read from the transaction. */
  onLocated: (p: { timelockHeight: number }) => void;
  onSigned: (hash: string) => void;
  onDropped: () => void;
}

/** Network edges of the deposit flow, swappable as one object. */
export interface DepositDeps {
  pollSpv(txid: string): Promise<SpvPoll>;
  findOutput(txid: string, address: string): Promise<OutputLookup>;
  /** Finds this Bitcoin key's Writz output in `txid` and the timelock it was built with. */
  locateDeposit(txid: string, btcPubkey: string): Promise<DepositLookup>;
  /** The depositor of `get_position(txid)` on `writz-lend`, or null when it has none. */
  getDepositor(btcTxid: string): Promise<string | null>;
  getTxStatus(hash: string): Promise<TxStatus>;
  /** Signs and submits `deposit()`; resolves once confirmed. */
  register(input: RegisterInput): Promise<{ hash: string }>;
  /** Reads the registered position from the chain and saves it on this device. */
  finalize(pd: PendingDeposit): Promise<Position>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function requireProtocolPubkey(): string {
  const key = config.bitcoin.protocolPubkey;
  if (!key) throw new Error("NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY is not configured.");
  return key;
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

/** The `writz-lend.deposit` arguments for a confirmed deposit. Pure, for tests. */
export function depositArgs(params: {
  pd: Pick<PendingDeposit, "stellarAddress" | "btcPubkey">;
  bundle: Pick<SpvBundle, "sorobanArgs">;
  scriptPubKey: Buffer;
  timelockHeight: number;
  keySig: Buffer;
}) {
  const { pd, bundle, scriptPubKey, timelockHeight, keySig } = params;
  const { sorobanArgs } = bundle;
  return {
    depositor: pd.stellarAddress,
    block_hash: Buffer.from(sorobanArgs.block_hash, "hex"),
    merkle_proof: sorobanArgs.merkle_proof.map((h) => Buffer.from(h, "hex")),
    tx_index: sorobanArgs.tx_index,
    raw_tx: Buffer.from(sorobanArgs.raw_tx, "hex"),
    p2wsh_script_pubkey: scriptPubKey,
    timelock_height: timelockHeight,
    user_pubkey: Buffer.from(pd.btcPubkey, "hex"),
    key_sig: keySig,
  };
}

async function realRegister(input: RegisterInput): Promise<{ hash: string }> {
  const { pd, bundle, signTransaction, emit } = input;
  // The contract rebuilds this depositor's script and counts exactly that
  // output's value as collateral, so the call must name the same output.
  const protocolPubkeyHex = requireProtocolPubkey();
  const output = findDepositOutput({
    rawTxHex: bundle.rawTxNoWitness,
    protocolPubkeyHex,
    userPubkeyHex: pd.btcPubkey,
    tipHeight: await fetchTipHeight(config.bitcoin.apiUrl),
    hintTimelock: pd.timelockHeight,
  });
  if (!output) throw new Error("This transaction does not pay your deposit address.");
  if (output.valueSats < MIN_DEPOSIT_SATS) {
    throw new Error(`This deposit pays ${output.valueSats} sats; the minimum is ${MIN_DEPOSIT_SATS}.`);
  }
  input.onLocated({ timelockHeight: output.timelockHeight });
  const { scriptPubKey } = deriveP2WSH(protocolPubkeyHex, pd.btcPubkey, output.timelockHeight);

  const contractId = writzLendId();
  // The contract only accepts a deposit signed by the Bitcoin key the output
  // is locked to, over this contract, this account and this txid
  // (GHSA-862g-739q-x6h8).
  emit({ type: "awaiting_signature", wallet: "bitcoin" });
  const keySig = parseMessageSignature(
    await input.signKeyProof(depositKeyMessage(contractId, pd.stellarAddress, pd.btcTxid)),
  );
  const client = writzLendClient(pd.stellarAddress, contractId);
  emit({ type: "preparing", step: "building" });
  const args = depositArgs({ pd, bundle, scriptPubKey, timelockHeight: output.timelockHeight, keySig });
  const tx = await simulateWritzLend(() => client.deposit(args));
  const { hash } = await signAndSubmit(tx, {
    signTransaction,
    emit,
    onSigned: input.onSigned,
    onDropped: input.onDropped,
  });
  return { hash };
}

/** Saves the registered position, with the chain's figures, and closes the pending deposit. */
async function realFinalize(pd: PendingDeposit): Promise<Position> {
  const position = await syncPosition(pd.stellarAddress, pd.btcTxid, {
    stellarTxHash: pd.stellarTxHash,
    createdAt: pd.createdAt,
    index: pd.positionIndex,
  });
  if (!position) throw new Error("PositionNotFound");
  return position;
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
  async locateDeposit(txid, btcPubkey) {
    const api = config.bitcoin.apiUrl;
    const res = await fetch(`${api}/tx/${txid}/hex`).catch(() => null);
    if (!res?.ok) return "unseen";
    const rawTxHex = (await res.text()).trim();
    const protocolPubkeyHex = requireProtocolPubkey();
    const out = findDepositOutput({
      rawTxHex,
      protocolPubkeyHex,
      userPubkeyHex: btcPubkey,
      tipHeight: await fetchTipHeight(api),
    });
    if (!out) return "no_output";
    const { address } = deriveP2WSH(protocolPubkeyHex, btcPubkey, out.timelockHeight);
    return { vout: out.vout, sats: out.valueSats, timelockHeight: out.timelockHeight, p2wsh: address };
  },
  async getDepositor(btcTxid) {
    return (await readPosition(btcTxid))?.depositor ?? null;
  },
  getTxStatus,
  register: realRegister,
  finalize: realFinalize,
  sleep: abortableSleep,
};

// ── Starting a deposit ────────────────────────────────────────────────────

interface StartContext {
  owner: string;
  btcPubkey: string;
  usedIndices: number[];
  emit: Emit;
}

/** The lock address a deposit pays and the timelock it was derived with. */
export interface DepositLock {
  p2wsh: string;
  timelockHeight: number;
}

function newPending(
  ctx: StartContext,
  lock: DepositLock,
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
    p2wsh: lock.p2wsh,
    btcPubkey: ctx.btcPubkey,
    timelockHeight: lock.timelockHeight,
    stellarAddress: ctx.owner,
    positionIndex,
    step: vout === undefined ? "sent" : "confirming",
    createdAt: now,
    updatedAt: now,
  };
}

/** Sends BTC from the wallet and persists the PendingDeposit the moment the wallet returns a txid. */
export async function startDepositBySending(
  ctx: StartContext & { lock: DepositLock; sats: bigint; send: (to: string, sats: number) => Promise<string> },
): Promise<PendingDeposit> {
  const index = await locks().reservePositionIndex(ctx.owner, ctx.usedIndices);
  ctx.emit({ type: "awaiting_signature", wallet: "bitcoin" });
  let txid: string;
  try {
    txid = await ctx.send(ctx.lock.p2wsh, Number(ctx.sats));
  } catch (e) {
    await locks().releasePositionIndex(ctx.owner, index);
    throw e;
  }
  return pendingDeposits.save(newPending(ctx, ctx.lock, txid.toLowerCase(), ctx.sats, index));
}

/**
 * Starts from a txid the user pasted. Amount, output index and timelock come
 * from Bitcoin, never from the form or this device.
 */
export async function startDepositFromTxid(
  ctx: StartContext & { txid: string; deps?: DepositDeps },
): Promise<PendingDeposit> {
  const deps = ctx.deps ?? depositDeps;
  const txid = ctx.txid.trim().toLowerCase();
  ctx.emit({ type: "preparing", step: "locating_output" });
  const out = await deps.locateDeposit(txid, ctx.btcPubkey);
  if (out === "unseen") throw new Error("Bitcoin hasn't seen this transaction yet.");
  if (out === "no_output") throw new Error("This transaction does not pay your deposit address.");
  const index = await locks().reservePositionIndex(ctx.owner, ctx.usedIndices);
  return pendingDeposits.save(newPending(ctx, out, txid, out.sats, index, out.vout));
}

// ── Resuming and driving a deposit ────────────────────────────────────────

export type TrackResult = { status: "ready"; pd: PendingDeposit } | { status: "active"; position: Position };

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

async function finalizeDeposit(pd: PendingDeposit, deps: DepositDeps): Promise<Position> {
  const position = await deps.finalize(pd);
  pendingDeposits.clear(pd.stellarAddress);
  await locks().releasePositionIndex(pd.stellarAddress, pd.positionIndex);
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

    const depositorForTxid = await withRetry(() => deps.getDepositor(pd!.btcTxid), deps, signal);
    const stellarTx =
      pd.stellarTxHash && !depositorForTxid
        ? await deps.getTxStatus(pd.stellarTxHash).catch(() => "NOT_FOUND" as const)
        : null;

    const plan = planResume(pd, { depositorForTxid, stellarTx }, Date.now());
    switch (plan.action) {
      case "finalize":
        return { status: "active", position: await finalizeDeposit(pd, deps) };
      case "conflict":
        throw new Error("PositionAlreadyExists");
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

/**
 * Signs and submits the Stellar deposit for a confirmed BTC transaction.
 * Checks the chain first so a resumed deposit never calls `deposit()` twice.
 */
export async function registerDeposit(params: {
  owner: string;
  signTransaction: SignTransaction;
  signKeyProof: (message: string) => Promise<string>;
  emit: Emit;
  signal?: AbortSignal;
  deps?: DepositDeps;
}): Promise<Position> {
  const { owner, signTransaction, signKeyProof, emit, signal } = params;
  const deps = params.deps ?? depositDeps;

  const tracked = await trackDeposit(owner, { emit, signal, deps });
  if (tracked.status === "active") {
    emit({ type: "settled", hash: tracked.position.stellarTxHash });
    return tracked.position;
  }

  let pd = tracked.pd;
  emit({ type: "preparing", step: "reading" });
  const bundle = await waitForConfirmations(pd, emit, deps, signal);

  let hash: string;
  try {
    ({ hash } = await deps.register({
      pd,
      bundle,
      signTransaction,
      signKeyProof,
      emit,
      onLocated: ({ timelockHeight }) => {
        pd = pendingDeposits.update(owner, { timelockHeight })!;
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
  emit({ type: "post_processing", step: "finalize" });
  // The RPC that confirmed the deposit can trail its own read of the new position by a ledger.
  let position: Position | null = null;
  for (let attempt = 0; !position; attempt++) {
    try {
      position = await finalizeDeposit(pd, deps);
    } catch (e) {
      if (attempt >= 4) {
        emit({ type: "needs_attention", action: "finish_deposit", error: e, hash });
        throw e;
      }
      await deps.sleep(3_000, signal);
    }
  }
  emit({ type: "settled", hash });
  return position;
}
