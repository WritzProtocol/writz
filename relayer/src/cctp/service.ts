/**
 * CCTP relay: completes on Base Sepolia the USDC transfers borrowers burn on
 * Stellar, so a borrower who sends a loan there needs no wallet, gas or
 * second signature on that chain. Circle signs each burn (Iris); anyone may
 * then call `receiveMessage` on MessageTransmitterV2, and the relay does so
 * with its own testnet key and gas.
 *
 * A request returns at once; the work runs as a background job per burn:
 * poll Iris with backoff for a bounded window, check the signed message is a
 * Stellar to Base Sepolia USDC mint (`assertRelayable`), then mint.
 *
 * Minting twice is impossible on chain: MessageTransmitterV2 spends each
 * nonce once. What the relay guards is its own gas, so it never sends a mint
 * it can know to be redundant: one job per burn, every mint from the one key
 * serialized behind a lock (which is also its EVM nonce management: each
 * send waits for its receipt before the next is built), the record re-read
 * inside the lock, the relay's own earlier broadcast checked before anything
 * new is sent, `usedNonces` checked before every simulation, and a
 * simulation before every send.
 *
 * Failures are either final or transient (`FailureCode` in `store.ts`). A
 * transient one (Circle slow to finalize, Base Sepolia unreachable, the gas
 * account empty, the daily cap) is retried by the relay itself with
 * exponential backoff, so an app that asked once is never left at a dead
 * end: a sweep picks up records whose `retryAt` has passed, and so does any
 * request about one. Retries go through the same job, lock and checks as the
 * first attempt. After `RETRY_GIVE_UP_MS` of failing the relay gives up and
 * reports `failed`.
 */
import { assertRelayable, BASE_SEPOLIA_MESSAGE_TRANSMITTER, MessageRefusedError } from "./message.js";
import { fetchIrisMessage, type IrisLookup } from "./iris.js";
import { SendError, type MintLog, type ReceiptOutcome, type RelayChain } from "./chain.js";
import { findMintOnIndexer } from "./indexer.js";
import {
  isRetrying,
  isSettled,
  lookupCctpRelay,
  normalizeBurnHash,
  toRelayView,
  type CctpRelayView,
  type FailureCode,
  type RelayRecord,
  type RelayStore,
} from "./store.js";

/** How long a burn Iris has never heard of is polled before the relay gives up on it. */
const UNSEEN_TIMEOUT_MS = 10 * 60_000;
/** Receipt waits per mint before the job stops and leaves the transfer to a later request. */
const RECEIPT_WAITS = 4;
/** Monitoring threshold for the relay's gas balance: 0.002 ETH. */
export const LOW_BALANCE_WEI = 2_000_000_000_000_000n;
const BALANCE_CACHE_MS = 15_000;
/** First automatic retry after a transient failure; doubles per attempt up to `RETRY_MAX_MS`. */
export const RETRY_INITIAL_MS = 30_000;
export const RETRY_MAX_MS = 15 * 60_000;
/**
 * How long a transfer keeps failing transiently before the relay stops and
 * reports `failed`: long enough to ride out an RPC outage, a gas refill or a
 * daily-cap reset, short enough that a broken transfer does not linger.
 */
export const RETRY_GIVE_UP_MS = 24 * 60 * 60_000;
/** An out-of-gas transfer is retried only once the account holds this much: 0.0001 ETH, far above one mint. */
export const MIN_RETRY_BALANCE_WEI = 100_000_000_000_000n;
/** Searches for the mint hash of a transfer someone else completed, before the relay stops looking. */
export const MINT_LOOKUP_ATTEMPTS = 8;
/** How often the relayer looks for records whose retry is due. */
export const RETRY_SWEEP_MS = 15_000;

export interface RelaySettings {
  irisUrl: string;
  /** Give up on a burn Circle has not confirmed within this time (per request). */
  confirmTimeoutMs: number;
  /** Mints the relay broadcasts per UTC day. */
  dailyCap: number;
  /** Transfers in flight at once; new ones are refused with `relay_busy` beyond this. */
  maxOpen: number;
  /** First Iris poll interval; it doubles up to `pollMaxMs`. */
  pollInitialMs: number;
  pollMaxMs: number;
  /**
   * Etherscan-compatible API of a Base Sepolia indexer (Blockscout), asked
   * for the mint that spent a nonce when the RPC log search finds nothing.
   * Unset: only the RPC is searched.
   */
  mintIndexerUrl?: string;
}

export interface RelayOptions {
  chain: RelayChain;
  store: RelayStore;
  settings: RelaySettings;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export type RelayErrorCode = "invalid_burn_hash" | "not_found" | "relay_busy";

const HTTP_STATUS: Record<RelayErrorCode, number> = {
  invalid_burn_hash: 400,
  not_found: 404,
  relay_busy: 503,
};

export class RelayError extends Error {
  readonly httpStatus: number;
  constructor(
    public readonly code: RelayErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "RelayError";
    this.httpStatus = HTTP_STATUS[code];
  }
}

export interface RelayStatus {
  enabled: true;
  network: "base-sepolia";
  address: string;
  /** Wei, as a decimal string; null when the RPC is unavailable. */
  balanceWei: string | null;
  lowBalance: boolean | null;
  messageTransmitter: string;
  mintsToday: number;
  dailyCap: number;
  inFlight: number;
}

function startOfUtcDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 24 * 60 * 60_000;

/** Delay before automatic attempt number `attempt` (1-based). */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_INITIAL_MS * 2 ** Math.max(0, attempt - 1), RETRY_MAX_MS);
}

export class CctpRelay {
  readonly address: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly jobs = new Map<string, Promise<void>>();
  private queue: Promise<unknown> = Promise.resolve();
  private balanceCache: { at: number; wei: bigint } | undefined;

  constructor(private readonly opts: RelayOptions) {
    this.address = opts.chain.address;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? ((line) => console.log(line));
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Starts (or resumes) relaying `rawHash` and returns where it stands.
   * Idempotent: a transfer already in flight or arrived is only reported, and
   * a refused one stays refused. A transient failure is retried on its own
   * schedule (asking again only brings forward a retry that is already due);
   * a transfer the relay stopped on without refusing it (a burn Circle never
   * reported, the give-up deadline) starts over.
   */
  request(rawHash: unknown): CctpRelayView {
    const burnHash = this.parse(rawHash);
    const t = this.now();
    const existing = this.opts.store.get(burnHash);
    if (existing && (isRetrying(existing) || !(existing.state === "failed" && existing.retryable))) {
      if (!isSettled(existing)) this.start(burnHash);
      else this.retry(burnHash);
      return toRelayView(this.opts.store.get(burnHash)!);
    }
    if (this.jobs.size >= this.opts.settings.maxOpen) {
      throw new RelayError("relay_busy", "the relay is handling as many transfers as it can; try again shortly", 30);
    }
    const record: RelayRecord = existing
      ? {
          ...existing,
          state: existing.attestation ? "confirmed" : "sent",
          failure: undefined,
          failureCode: undefined,
          retryable: false,
          retryAt: undefined,
          attempts: undefined,
          retryingSince: undefined,
          updatedAt: t,
        }
      : { burnHash, state: "sent", retryable: false, createdAt: t, updatedAt: t };
    this.opts.store.put(record);
    this.start(burnHash);
    return toRelayView(record);
  }

  /**
   * Where a transfer stands. Starts nothing new, but a retry that is already
   * due runs now rather than at the next sweep, so an app polling a
   * transient failure moves on as soon as the backoff allows.
   */
  status(rawHash: unknown): CctpRelayView {
    const burnHash = this.parse(rawHash);
    if (!this.opts.store.get(burnHash)) {
      throw new RelayError("not_found", "the relay has no transfer for this burn; send it with POST /cctp/relay first");
    }
    this.retry(burnHash);
    return lookupCctpRelay(this.opts.store, burnHash)!;
  }

  /** Read-only lookup by burn hash, for the full-cycle timeline. */
  lookup(burnHash: string): CctpRelayView | undefined {
    return lookupCctpRelay(this.opts.store, burnHash);
  }

  /** Restarts every transfer a previous process left in flight. Call once at startup. */
  resume(): number {
    const open = this.opts.store.listOpen();
    for (const r of open) this.start(r.burnHash);
    return open.length;
  }

  /** Runs every retry whose time has come; returns how many started. The sweep calls it every `RETRY_SWEEP_MS`. */
  retryDue(): number {
    let started = 0;
    for (const r of this.opts.store.listDue(this.now())) {
      if (this.retry(r.burnHash)) started += 1;
    }
    return started;
  }

  /** Starts the periodic sweep for due retries; returns a function that stops it. */
  startRetrySweep(intervalMs = RETRY_SWEEP_MS): () => void {
    const timer = setInterval(() => {
      try {
        this.retryDue();
      } catch (e) {
        this.log(JSON.stringify({ evt: "cctp_relay_sweep_error", message: e instanceof Error ? e.message : String(e) }));
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  /** Settles once every running job has finished; for tests and orderly shutdown. */
  async idle(): Promise<void> {
    while (this.jobs.size > 0) await Promise.all([...this.jobs.values()]);
  }

  async info(): Promise<RelayStatus> {
    const t = this.now();
    let balanceWei: bigint | null = null;
    if (this.balanceCache && t - this.balanceCache.at < BALANCE_CACHE_MS) {
      balanceWei = this.balanceCache.wei;
    } else {
      try {
        balanceWei = await this.opts.chain.balanceWei();
        this.balanceCache = { at: t, wei: balanceWei };
      } catch {
        balanceWei = null;
      }
    }
    return {
      enabled: true,
      network: "base-sepolia",
      address: this.address,
      balanceWei: balanceWei === null ? null : balanceWei.toString(),
      lowBalance: balanceWei === null ? null : balanceWei < LOW_BALANCE_WEI,
      messageTransmitter: BASE_SEPOLIA_MESSAGE_TRANSMITTER,
      mintsToday: this.opts.store.countSubmittedSince(startOfUtcDay(t)),
      dailyCap: this.opts.settings.dailyCap,
      inFlight: this.jobs.size,
    };
  }

  private parse(rawHash: unknown): string {
    const burnHash = normalizeBurnHash(rawHash);
    if (!burnHash) {
      throw new RelayError("invalid_burn_hash", "burnHash must be a Stellar transaction hash: 64 hexadecimal characters");
    }
    return burnHash;
  }

  private start(burnHash: string): void {
    this.launch(burnHash, () => this.run(burnHash));
  }

  /** One job per burn: a second launch while one runs is a no-op. */
  private launch(burnHash: string, work: () => Promise<void>): boolean {
    if (this.jobs.has(burnHash)) return false;
    const job = work()
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        this.log(JSON.stringify({ evt: "cctp_relay_error", burnHash, message }));
        const current = this.opts.store.get(burnHash);
        if (current && current.state !== "arrived") this.transient(burnHash, "unexpected", "the relay hit an unexpected error");
      })
      .finally(() => this.jobs.delete(burnHash));
    this.jobs.set(burnHash, job);
    return true;
  }

  /**
   * Starts the retry of `burnHash` if one is due: the next attempt of a
   * transient failure, or the next search for the mint hash of an arrived
   * transfer. False when nothing is due, the burn already has a job, or the
   * relay is at its in-flight limit (the sweep tries again later).
   */
  private retry(burnHash: string): boolean {
    const r = this.opts.store.get(burnHash);
    if (!r || r.retryAt === undefined || r.retryAt > this.now()) return false;
    if (this.jobs.has(burnHash) || this.jobs.size >= this.opts.settings.maxOpen) return false;
    if (r.state === "arrived") return this.launch(burnHash, () => this.lookupMintAgain(r));
    if (!isRetrying(r)) return false;
    return this.launch(burnHash, () => this.resumeFailed(r));
  }

  private async resumeFailed(r: RelayRecord): Promise<void> {
    // No point re-running a mint the account still cannot pay for: wait for
    // the refill, counting it as an attempt so the give-up deadline holds.
    if (r.failureCode === "out_of_gas" && !(await this.canPayForMint())) {
      this.transient(r.burnHash, "out_of_gas", r.failure ?? "the relay is out of Base Sepolia gas");
      return;
    }
    this.update(r.burnHash, {
      state: r.attestation ? "confirmed" : "sent",
      failure: undefined,
      failureCode: undefined,
      retryAt: undefined,
      retryable: false,
    });
    this.log(JSON.stringify({ evt: "cctp_relay_retry", burnHash: r.burnHash, attempt: r.attempts ?? 0, after: r.failureCode }));
    await this.run(r.burnHash);
  }

  private async canPayForMint(): Promise<boolean> {
    try {
      const wei = await this.opts.chain.balanceWei();
      this.balanceCache = { at: this.now(), wei };
      return wei >= MIN_RETRY_BALANCE_WEI;
    } catch {
      return false;
    }
  }

  private withLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private update(burnHash: string, patch: Partial<RelayRecord>): RelayRecord {
    const current = this.opts.store.get(burnHash);
    if (!current) throw new Error(`no relay record for ${burnHash}`);
    const next = { ...current, ...patch, updatedAt: this.now() };
    this.opts.store.put(next);
    return next;
  }

  /**
   * A final failure. `refused` and `mint_refused` never change; `unseen` and
   * `gave_up` start over on a new POST (`retryable`), never by themselves.
   */
  private fail(burnHash: string, code: FailureCode, reason: string): void {
    const retryable = code !== "refused" && code !== "mint_refused";
    this.update(burnHash, { state: "failed", retryable, failure: reason, failureCode: code, retryAt: undefined });
    this.log(JSON.stringify({ evt: "cctp_relay_failed", burnHash, code, retryable, reason }));
  }

  /**
   * A transient failure: scheduled for an automatic retry with exponential
   * backoff (the daily cap waits for 00:00 UTC), or, once the streak has
   * lasted `RETRY_GIVE_UP_MS`, turned into a final `gave_up`.
   */
  private transient(burnHash: string, code: FailureCode, reason: string): void {
    const current = this.opts.store.get(burnHash);
    const t = this.now();
    const since = current?.retryingSince ?? t;
    const attempts = (current?.attempts ?? 0) + 1;
    if (t - since >= RETRY_GIVE_UP_MS) {
      this.update(burnHash, { attempts, retryingSince: since });
      this.fail(
        burnHash,
        "gave_up",
        `the relay stopped after ${RETRY_GIVE_UP_MS / 3_600_000} hours of retrying (${reason}); ask again to start over`,
      );
      return;
    }
    const retryAt = code === "daily_cap" ? startOfUtcDay(t) + DAY_MS : t + retryDelayMs(attempts);
    this.update(burnHash, {
      state: "failed",
      retryable: true,
      failure: reason,
      failureCode: code,
      retryAt,
      attempts,
      retryingSince: since,
    });
    this.log(JSON.stringify({ evt: "cctp_relay_retry_scheduled", burnHash, code, attempt: attempts, retryAt: new Date(retryAt).toISOString(), reason }));
  }

  private async run(burnHash: string): Promise<void> {
    let record = this.opts.store.get(burnHash);
    if (!record || isSettled(record)) return;
    if (!record.attestation) {
      record = await this.awaitMessage(record);
      if (isSettled(record)) return;
    }
    await this.withLock(() => this.mint(burnHash));
  }

  /** Polls Iris until Circle has signed the burn, the message is refused, or the window closes. */
  private async awaitMessage(start: RelayRecord): Promise<RelayRecord> {
    const { irisUrl, confirmTimeoutMs, pollInitialMs, pollMaxMs } = this.opts.settings;
    const begun = this.now();
    let record = start;
    let delay = pollInitialMs;
    for (;;) {
      let lookup: IrisLookup | undefined;
      try {
        lookup = await fetchIrisMessage(irisUrl, record.burnHash, this.fetchImpl);
      } catch (e) {
        this.log(JSON.stringify({ evt: "cctp_relay_iris_error", burnHash: record.burnHash, message: (e as Error).message }));
      }

      if (lookup?.state === "complete") {
        try {
          const { message, mintRecipient } = assertRelayable(lookup.message);
          return this.update(record.burnHash, {
            state: "confirmed",
            nonce: message.nonce,
            recipient: mintRecipient,
            amount: message.body.amount,
            feeExecuted: message.body.feeExecuted,
            message: lookup.message,
            attestation: lookup.attestation,
          });
        } catch (e) {
          if (!(e instanceof MessageRefusedError)) throw e;
          this.fail(record.burnHash, "refused", `the relay does not complete this transfer: ${e.message}`);
          return this.opts.store.get(record.burnHash)!;
        }
      }
      if (lookup?.state === "pending" && record.state === "sent") {
        record = this.update(record.burnHash, { state: "confirming" });
      }

      const unseen = record.state === "sent";
      const limit = unseen ? Math.min(UNSEEN_TIMEOUT_MS, confirmTimeoutMs) : confirmTimeoutMs;
      if (this.now() - begun >= limit) {
        if (unseen) {
          // Circle indexes a real burn within seconds; ten minutes of silence
          // almost always means the hash is not a CCTP transfer, so this is
          // not retried by itself.
          this.fail(record.burnHash, "unseen", "Circle has no record of this burn; check that it is a CCTP transfer sent from Stellar");
        } else {
          this.transient(record.burnHash, "confirm_timeout", "Circle has not confirmed the transfer yet");
        }
        return this.opts.store.get(record.burnHash)!;
      }
      await this.sleep(delay);
      delay = Math.min(delay * 2, pollMaxMs);
    }
  }

  /** Runs inside the lock: at most one mint from the relay key at a time. */
  private async mint(burnHash: string): Promise<void> {
    const { chain } = this.opts;
    // Re-read inside the lock: a job queued behind another for the same burn sees its outcome.
    const record = this.opts.store.get(burnHash);
    if (!record || isSettled(record) || !record.nonce || !record.message || !record.attestation) return;

    // The relay's own earlier broadcast (before a restart, or one that was slow
    // to mine) comes first: sending again while it may still land wastes gas.
    if (record.mintHash && record.mintedBy === "relay") {
      const outcome = await this.awaitReceipt(record.mintHash);
      if (outcome === "success") {
        this.arrived(burnHash, record.mintHash, "relay");
        return;
      }
      if (outcome === "pending" && !(await chain.isNonceUsed(record.nonce))) {
        this.transient(burnHash, "not_mined", "the mint transaction on Base Sepolia is not mined yet");
        return;
      }
    }

    if (await chain.isNonceUsed(record.nonce)) {
      await this.mintedElsewhere(burnHash, record.nonce);
      return;
    }

    const { dailyCap } = this.opts.settings;
    if (this.opts.store.countSubmittedSince(startOfUtcDay(this.now())) >= dailyCap) {
      this.transient(burnHash, "daily_cap", `the relay reached its daily limit of ${dailyCap} transfers; it resumes after 00:00 UTC`);
      return;
    }

    const sim = await chain.simulateReceive(record.message, record.attestation);
    if (!sim.ok) {
      // Someone may have completed it between the nonce check and the simulation.
      if (await chain.isNonceUsed(record.nonce)) {
        await this.mintedElsewhere(burnHash, record.nonce);
        return;
      }
      this.log(JSON.stringify({ evt: "cctp_relay_simulation_failed", burnHash, transient: sim.transient, detail: sim.detail }));
      if (sim.transient) this.transient(burnHash, "rpc", "Base Sepolia could not be reached");
      else this.fail(burnHash, "mint_refused", `Base Sepolia refused the mint: ${sim.revert ?? "reverted"}`);
      return;
    }

    let mintHash: string;
    try {
      mintHash = await chain.sendReceive(record.message, record.attestation);
    } catch (e) {
      if (e instanceof SendError && e.kind === "insufficient_funds") {
        console.warn(JSON.stringify({ evt: "cctp_relay_out_of_gas", address: this.address }));
        this.transient(burnHash, "out_of_gas", "the relay is out of Base Sepolia gas; it retries once the account is refilled");
        return;
      }
      // The broadcast may have reached the node anyway; a retry finds the
      // nonce spent and the mint in the logs rather than sending again.
      this.log(JSON.stringify({ evt: "cctp_relay_send_failed", burnHash, message: (e as Error).message }));
      this.transient(burnHash, "send_failed", "the mint could not be sent to Base Sepolia");
      return;
    }

    const t = this.now();
    this.update(burnHash, { state: "submitted", mintHash, mintedBy: "relay", submittedAt: t });
    this.balanceCache = undefined;
    this.log(JSON.stringify({ evt: "cctp_relay_submitted", burnHash, mintHash }));

    const outcome = await this.awaitReceipt(mintHash);
    if (outcome === "success") {
      this.arrived(burnHash, mintHash, "relay");
      await this.warnIfLow();
      return;
    }
    if (await chain.isNonceUsed(record.nonce)) {
      // Reverted because someone else's mint landed first, or still pending
      // while another one did: either way the USDC arrived.
      await this.mintedElsewhere(burnHash, record.nonce);
      return;
    }
    // A mint that simulated fine and then reverted is retried: the retry
    // simulates again, and a lasting refusal turns final there.
    if (outcome === "reverted") this.transient(burnHash, "reverted", "the mint transaction reverted on Base Sepolia");
    else this.transient(burnHash, "not_mined", "the mint transaction on Base Sepolia is not mined yet");
  }

  private async awaitReceipt(txHash: string): Promise<ReceiptOutcome> {
    for (let i = 0; i < RECEIPT_WAITS; i++) {
      const outcome = await this.opts.chain.waitForReceipt(txHash);
      if (outcome !== "pending") return outcome;
    }
    return "pending";
  }

  /** The nonce is spent: the USDC is minted. Finds which transaction did it, for the app's link. */
  private async mintedElsewhere(burnHash: string, nonce: string): Promise<void> {
    const found = await this.findMintTx(burnHash, nonce);
    this.arrived(burnHash, found?.txHash, this.mintedByOf(found));
  }

  private mintedByOf(found: MintLog | undefined): "relay" | "other" {
    return found !== undefined && found.caller.toLowerCase() === this.address.toLowerCase() ? "relay" : "other";
  }

  /**
   * The `MessageReceived` log for `nonce`: the RPC search first (it reads the
   * chain directly, but only `CCTP_RELAY_MINT_LOOKBACK_BLOCKS` back), then
   * the indexer (whole chain, a third party whose answer is checked against
   * the contract, the event and the nonce). Undefined when neither has it.
   */
  private async findMintTx(burnHash: string, nonce: string): Promise<MintLog | undefined> {
    try {
      const found = await this.opts.chain.findMint(nonce);
      if (found) return found;
    } catch (e) {
      this.log(JSON.stringify({ evt: "cctp_relay_find_mint_failed", burnHash, source: "rpc", message: (e as Error).message }));
    }
    const { mintIndexerUrl } = this.opts.settings;
    if (!mintIndexerUrl) return undefined;
    try {
      return await findMintOnIndexer(mintIndexerUrl, nonce, this.fetchImpl);
    } catch (e) {
      this.log(JSON.stringify({ evt: "cctp_relay_find_mint_failed", burnHash, source: "indexer", message: (e as Error).message }));
      return undefined;
    }
  }

  /** Another search for the mint hash of a transfer that arrived without one. */
  private async lookupMintAgain(r: RelayRecord): Promise<void> {
    const found = r.nonce ? await this.findMintTx(r.burnHash, r.nonce) : undefined;
    if (found) {
      const mintedBy = this.mintedByOf(found);
      this.update(r.burnHash, { mintHash: found.txHash, mintedBy, retryAt: undefined, attempts: undefined });
      this.log(JSON.stringify({ evt: "cctp_relay_mint_found", burnHash: r.burnHash, mintHash: found.txHash, mintedBy }));
      return;
    }
    const attempts = (r.attempts ?? 0) + 1;
    const more = r.nonce !== undefined && attempts < MINT_LOOKUP_ATTEMPTS;
    this.update(r.burnHash, { attempts, retryAt: more ? this.now() + retryDelayMs(attempts + 1) : undefined });
  }

  private arrived(burnHash: string, mintHash: string | undefined, mintedBy: "relay" | "other"): void {
    // Without a hash the transfer is still complete; the hash is searched for
    // again later (`lookupMintAgain`) so the app can eventually link it.
    this.update(burnHash, {
      state: "arrived",
      mintHash,
      mintedBy,
      failure: undefined,
      failureCode: undefined,
      retryable: false,
      retryAt: mintHash ? undefined : this.now() + RETRY_INITIAL_MS,
      attempts: undefined,
      retryingSince: undefined,
    });
    this.log(JSON.stringify({ evt: "cctp_relay_arrived", burnHash, mintHash: mintHash ?? null, mintedBy }));
  }

  private async warnIfLow(): Promise<void> {
    try {
      const wei = await this.opts.chain.balanceWei();
      this.balanceCache = { at: this.now(), wei };
      if (wei < LOW_BALANCE_WEI) {
        console.warn(JSON.stringify({ evt: "cctp_relay_low_balance", address: this.address, balanceWei: wei.toString() }));
      }
    } catch {
      // A balance read failing is not worth failing a mint that landed.
    }
  }
}
