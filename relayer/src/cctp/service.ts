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
 */
import { assertRelayable, BASE_SEPOLIA_MESSAGE_TRANSMITTER, MessageRefusedError } from "./message.js";
import { fetchIrisMessage, type IrisLookup } from "./iris.js";
import { SendError, type ReceiptOutcome, type RelayChain } from "./chain.js";
import {
  isSettled,
  lookupCctpRelay,
  normalizeBurnHash,
  toRelayView,
  type CctpRelayView,
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
   * a refused one stays refused. Only a failure marked retryable (a timeout,
   * an empty gas wallet) is picked up again.
   */
  request(rawHash: unknown): CctpRelayView {
    const burnHash = this.parse(rawHash);
    const t = this.now();
    const existing = this.opts.store.get(burnHash);
    if (existing && !(existing.state === "failed" && existing.retryable)) {
      if (!isSettled(existing)) this.start(burnHash);
      return toRelayView(existing);
    }
    if (this.jobs.size >= this.opts.settings.maxOpen) {
      throw new RelayError("relay_busy", "the relay is handling as many transfers as it can; try again shortly", 30);
    }
    const record: RelayRecord = existing
      ? {
          ...existing,
          state: existing.attestation ? "confirmed" : "sent",
          failure: undefined,
          retryable: false,
          updatedAt: t,
        }
      : { burnHash, state: "sent", retryable: false, createdAt: t, updatedAt: t };
    this.opts.store.put(record);
    this.start(burnHash);
    return toRelayView(record);
  }

  /** Where a transfer stands, without starting anything. */
  status(rawHash: unknown): CctpRelayView {
    const burnHash = this.parse(rawHash);
    const view = lookupCctpRelay(this.opts.store, burnHash);
    if (!view) throw new RelayError("not_found", "the relay has no transfer for this burn; send it with POST /cctp/relay first");
    return view;
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
    if (this.jobs.has(burnHash)) return;
    const job = this.run(burnHash)
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        this.log(JSON.stringify({ evt: "cctp_relay_error", burnHash, message }));
        this.fail(burnHash, true, "the relay hit an unexpected error; ask again shortly");
      })
      .finally(() => this.jobs.delete(burnHash));
    this.jobs.set(burnHash, job);
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

  private fail(burnHash: string, retryable: boolean, reason: string): void {
    this.update(burnHash, { state: "failed", retryable, failure: reason });
    this.log(JSON.stringify({ evt: "cctp_relay_failed", burnHash, retryable, reason }));
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
          this.fail(record.burnHash, false, `the relay does not complete this transfer: ${e.message}`);
          return this.opts.store.get(record.burnHash)!;
        }
      }
      if (lookup?.state === "pending" && record.state === "sent") {
        record = this.update(record.burnHash, { state: "confirming" });
      }

      const unseen = record.state === "sent";
      const limit = unseen ? Math.min(UNSEEN_TIMEOUT_MS, confirmTimeoutMs) : confirmTimeoutMs;
      if (this.now() - begun >= limit) {
        this.fail(
          record.burnHash,
          true,
          unseen
            ? "Circle has no record of this burn; check that it is a CCTP transfer sent from Stellar"
            : "Circle did not confirm the transfer in time; ask again to resume",
        );
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
        this.fail(burnHash, true, "the mint transaction on Base Sepolia is not mined yet; ask again shortly");
        return;
      }
    }

    if (await chain.isNonceUsed(record.nonce)) {
      await this.mintedElsewhere(burnHash, record.nonce);
      return;
    }

    const { dailyCap } = this.opts.settings;
    if (this.opts.store.countSubmittedSince(startOfUtcDay(this.now())) >= dailyCap) {
      this.fail(burnHash, true, `the relay reached its daily limit of ${dailyCap} transfers; it resets at 00:00 UTC`);
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
      if (sim.transient) this.fail(burnHash, true, "Base Sepolia could not be reached; ask again shortly");
      else this.fail(burnHash, false, `Base Sepolia refused the mint: ${sim.revert ?? "reverted"}`);
      return;
    }

    let mintHash: string;
    try {
      mintHash = await chain.sendReceive(record.message, record.attestation);
    } catch (e) {
      if (e instanceof SendError && e.kind === "insufficient_funds") {
        console.warn(JSON.stringify({ evt: "cctp_relay_out_of_gas", address: this.address }));
        this.fail(burnHash, true, "the relay is out of Base Sepolia gas; ask again once it is refilled");
        return;
      }
      // The broadcast may have reached the node anyway; a retry finds the
      // nonce spent and the mint in the logs rather than sending again.
      this.log(JSON.stringify({ evt: "cctp_relay_send_failed", burnHash, message: (e as Error).message }));
      this.fail(burnHash, true, "the mint could not be sent to Base Sepolia; ask again shortly");
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
    if (outcome === "reverted") this.fail(burnHash, true, "the mint transaction reverted on Base Sepolia; ask again to retry");
    else this.fail(burnHash, true, "the mint transaction on Base Sepolia is not mined yet; ask again shortly");
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
    let found: Awaited<ReturnType<RelayChain["findMint"]>>;
    try {
      found = await this.opts.chain.findMint(nonce);
    } catch (e) {
      this.log(JSON.stringify({ evt: "cctp_relay_find_mint_failed", burnHash, message: (e as Error).message }));
    }
    const byRelay = found !== undefined && found.caller.toLowerCase() === this.address.toLowerCase();
    this.arrived(burnHash, found?.txHash, byRelay ? "relay" : "other");
  }

  private arrived(burnHash: string, mintHash: string | undefined, mintedBy: "relay" | "other"): void {
    this.update(burnHash, { state: "arrived", mintHash, mintedBy, failure: undefined, retryable: false });
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
