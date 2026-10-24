/**
 * Writz Signet faucet: pays a fixed amount of Signet test BTC from a
 * relayer-held P2WPKH hot wallet, so builders and testnet users do not need
 * a third-party faucet.
 *
 * The coins have no value; the realistic harm is a drained faucet that stops
 * working for the next person. Hence, per claim: a fixed amount, one claim
 * per recipient address per cooldown, a number of claims per client IP per
 * sliding window (sized so a venue or a classroom behind one IP can onboard
 * its people in one session), a global cap per UTC day, and a balance check
 * that fails closed with `faucet_empty`.
 *
 * Sends are serialized: coin selection, signing and broadcast run one at a
 * time, and the outpoints a broadcast spent are kept out of selection until
 * Esplora stops listing them, so the faucet never double-spends its own
 * UTXOs. Change from a broadcast is spendable right away (Signet).
 */
import { createHash } from "crypto";
import * as btc from "bitcoinjs-lib";
import {
  addressToOutputScript,
  buildP2wpkhPayment,
  estimateP2wpkhVsize,
  InsufficientFundsError,
  pubkeyToP2WPKHAddress,
  type P2wpkhUtxo,
  type WritzKeyPair,
} from "@writz/bitcoin-script";
import { EsploraError, isUpstreamUnavailable, type AddressUtxo } from "../bitcoin/esplora.js";
import type { ClaimStore } from "./store.js";

/** Hard ceiling on the per-claim amount, whatever the environment says. */
export const MAX_FAUCET_AMOUNT_SAT = 50_000;
/** Below this a claim is not worth a transaction. */
export const MIN_FAUCET_AMOUNT_SAT = 1_000;

/** Public Signet faucets, offered when this one cannot pay. */
export const PUBLIC_SIGNET_FAUCETS = [
  "https://signetfaucet.com",
  "https://bitcoinsignetfaucet.com",
  "https://signet.dcorral.com",
];

/** Monitoring threshold: warn when the balance covers fewer claims than this. */
const LOW_BALANCE_CLAIMS = 20;
/** How long a spent outpoint stays out of selection (covers indexer lag; a spent
 * outpoint never becomes spendable again, so expiry only bounds memory). */
const RESERVATION_TTL_MS = 30 * 60_000;
/** How long a status answer's balance is reused. */
const BALANCE_CACHE_MS = 15_000;

export interface FaucetEsplora {
  getAddressUtxos(address: string): Promise<AddressUtxo[]>;
  getFeeEstimates(): Promise<Record<string, number>>;
  broadcastTx(txHex: string): Promise<string>;
}

export interface FaucetSettings {
  amountSat: number;
  dailyCap: number;
  /** One claim per recipient address within this time. */
  cooldownMs: number;
  /** Claims allowed per client IP within any `ipWindowMs` (sliding window). */
  ipClaimsPerWindow: number;
  ipWindowMs: number;
  /** Fee floor and ceiling in sat/vbyte, applied to the Esplora estimate. */
  minFeeRate: number;
  maxFeeRate: number;
  /** Esplora confirmation target used for the estimate, in blocks. */
  feeTargetBlocks: number;
}

export interface FaucetOptions {
  wallet: WritzKeyPair;
  esplora: FaucetEsplora;
  store: ClaimStore;
  settings: FaucetSettings;
  now?: () => number;
  log?: (line: string) => void;
}

export type FaucetErrorCode =
  | "invalid_address"
  | "faucet_address"
  | "address_cooldown"
  | "ip_cooldown"
  | "daily_cap_reached"
  | "faucet_empty"
  | "upstream_unavailable"
  | "broadcast_rejected";

const HTTP_STATUS: Record<FaucetErrorCode, number> = {
  invalid_address: 400,
  faucet_address: 400,
  address_cooldown: 429,
  ip_cooldown: 429,
  daily_cap_reached: 429,
  faucet_empty: 503,
  upstream_unavailable: 503,
  broadcast_rejected: 502,
};

export class FaucetError extends Error {
  readonly httpStatus: number;
  constructor(
    public readonly code: FaucetErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "FaucetError";
    this.httpStatus = HTTP_STATUS[code];
  }
}

export interface ClaimResult {
  txid: string;
  address: string;
  amountSats: number;
  feeSats: number;
}

export interface FaucetStatus {
  enabled: true;
  network: "signet";
  address: string;
  amountSats: number;
  dailyCap: number;
  claimsToday: number;
  remainingToday: number;
  resetsAt: string;
  cooldownHours: number;
  /** Claims allowed per client IP within `ipWindowHours`. */
  ipClaimsPerWindow: number;
  ipWindowHours: number;
  /** Spendable balance (confirmed and unconfirmed), null if Esplora is unavailable. */
  balanceSats: number | null;
  /** Claims the balance still covers at the current amount, null if unknown. */
  claimsLeftAtBalance: number | null;
}

const BECH32_CHARS = /^tb1[02-9ac-hj-np-z]{8,87}$/;

/**
 * Validates a Signet recipient and returns it in canonical lowercase form.
 * Accepts native SegWit only: tb1q (P2WPKH, P2WSH, bech32) and tb1p
 * (P2TR, bech32m). Mainnet (bc1), regtest (bcrt1), legacy and P2SH
 * addresses, and future witness versions are refused.
 */
export function normalizeSignetAddress(raw: unknown): string {
  if (typeof raw !== "string") throw new FaucetError("invalid_address", "address must be a string");
  let address = raw.trim();
  // Bech32 is case-insensitive but never mixed-case; all-uppercase is valid (QR codes).
  if (address === address.toUpperCase()) address = address.toLowerCase();
  if (!BECH32_CHARS.test(address)) {
    throw new FaucetError(
      "invalid_address",
      "address must be a Bitcoin Signet native SegWit address (tb1q... or tb1p...)",
    );
  }
  let script: Buffer;
  try {
    script = addressToOutputScript(address, btc.networks.testnet);
  } catch {
    throw new FaucetError("invalid_address", "address is not a valid Bitcoin Signet address (checksum or length)");
  }
  const v0 = script[0] === 0x00 && (script.length === 22 || script.length === 34);
  const v1 = script[0] === 0x51 && script.length === 34;
  if (!v0 && !v1) {
    throw new FaucetError("invalid_address", "only SegWit v0 (tb1q) and Taproot (tb1p) addresses are supported");
  }
  return address;
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`writz-signet-faucet:${ip}`).digest("hex");
}

function startOfUtcDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const outpoint = (u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`;

export class SignetFaucet {
  readonly address: string;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private queue: Promise<unknown> = Promise.resolve();
  /** Outpoints spent by our own broadcasts -> expiry (ms). */
  private readonly reserved = new Map<string, number>();
  /** Change outputs of our own broadcasts, usable before Esplora lists them. */
  private pendingChange: (P2wpkhUtxo & { expiresAt: number })[] = [];
  private balanceCache: { at: number; sats: number } | undefined;

  constructor(private readonly opts: FaucetOptions) {
    const { amountSat } = opts.settings;
    if (!Number.isSafeInteger(amountSat) || amountSat < MIN_FAUCET_AMOUNT_SAT || amountSat > MAX_FAUCET_AMOUNT_SAT) {
      throw new Error(
        `FAUCET_AMOUNT_SATS must be an integer between ${MIN_FAUCET_AMOUNT_SAT} and ${MAX_FAUCET_AMOUNT_SAT}, got ${amountSat}`,
      );
    }
    const { ipClaimsPerWindow, ipWindowMs } = opts.settings;
    if (!Number.isSafeInteger(ipClaimsPerWindow) || ipClaimsPerWindow < 1) {
      throw new Error(`FAUCET_IP_CLAIMS_PER_WINDOW must be a positive integer, got ${ipClaimsPerWindow}`);
    }
    if (!Number.isFinite(ipWindowMs) || ipWindowMs <= 0) {
      throw new Error(`FAUCET_IP_WINDOW_HOURS must be a positive number, got ${ipWindowMs / 3_600_000}`);
    }
    this.address = pubkeyToP2WPKHAddress(opts.wallet.publicKey, btc.networks.testnet);
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((line) => console.log(line));
  }

  private withLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Spendable UTXOs: Esplora's view, minus what we spent, plus our unlisted change. */
  private async spendable(): Promise<P2wpkhUtxo[]> {
    const t = this.now();
    for (const [k, exp] of this.reserved) if (exp <= t) this.reserved.delete(k);
    this.pendingChange = this.pendingChange.filter((c) => c.expiresAt > t);

    const listed = await this.opts.esplora.getAddressUtxos(this.address);
    const listedKeys = new Set(listed.map(outpoint));
    // Reservations are kept until they expire, not dropped when Esplora stops
    // listing an outpoint: an indexer that lags can list it again (or list a
    // spent change output for the first time) after it was spent here.
    this.pendingChange = this.pendingChange.filter((c) => !listedKeys.has(outpoint(c)));

    const usable = listed
      .filter((u) => !this.reserved.has(outpoint(u)))
      .sort((a, b) => Number(b.status.confirmed) - Number(a.status.confirmed) || b.value - a.value)
      .map(({ txid, vout, value }) => ({ txid, vout, value }));
    const pending = this.pendingChange
      .filter((c) => !this.reserved.has(outpoint(c)))
      .map(({ txid, vout, value }) => ({ txid, vout, value }));
    return [...usable, ...pending];
  }

  private async feeRate(): Promise<number> {
    const { minFeeRate, maxFeeRate, feeTargetBlocks } = this.opts.settings;
    let estimate = minFeeRate;
    try {
      const estimates = await this.opts.esplora.getFeeEstimates();
      const value = estimates[String(feeTargetBlocks)];
      if (typeof value === "number" && Number.isFinite(value)) estimate = value;
    } catch (e) {
      this.log(JSON.stringify({ evt: "faucet_fee_estimate_failed", message: (e as Error).message }));
    }
    return Math.min(maxFeeRate, Math.max(minFeeRate, estimate));
  }

  private checkLimits(address: string, ipHash: string): void {
    const t = this.now();
    const { cooldownMs, ipClaimsPerWindow, ipWindowMs, dailyCap } = this.opts.settings;
    const lastAddr = this.opts.store.lastClaimForAddress(address);
    if (lastAddr !== undefined && t - lastAddr < cooldownMs) {
      throw new FaucetError(
        "address_cooldown",
        "this address already received coins from the faucet recently",
        Math.ceil((lastAddr + cooldownMs - t) / 1000),
      );
    }
    // Claims strictly inside the window (t - ipWindowMs, t]: one made exactly
    // ipWindowMs ago has left it, the same boundary as the address cooldown.
    const ipClaims = this.opts.store.ipClaimsSince(ipHash, t - ipWindowMs + 1);
    if (ipClaims.length >= ipClaimsPerWindow) {
      // A slot frees when enough of the oldest claims leave the window to bring
      // the count below the allowance (normally just the oldest one).
      const freesAt = ipClaims[ipClaims.length - ipClaimsPerWindow] + ipWindowMs;
      throw new FaucetError(
        "ip_cooldown",
        `this network has used its ${ipClaimsPerWindow} faucet claims for now; try again later`,
        Math.max(1, Math.ceil((freesAt - t) / 1000)),
      );
    }
    const dayStart = startOfUtcDay(t);
    if (this.opts.store.countSince(dayStart) >= dailyCap) {
      throw new FaucetError(
        "daily_cap_reached",
        "the faucet has paid its daily maximum; it resets at 00:00 UTC",
        Math.ceil((dayStart + 86_400_000 - t) / 1000),
      );
    }
  }

  /** Pays the configured amount to `rawAddress`. `ip` is the caller's address as Express resolved it. */
  async claim(rawAddress: unknown, ip: string): Promise<ClaimResult> {
    const address = normalizeSignetAddress(rawAddress);
    if (address === this.address) throw new FaucetError("faucet_address", "that is the faucet's own address");
    const ipHash = hashIp(ip);
    // Checked before queueing so a refused caller never waits behind a send...
    this.checkLimits(address, ipHash);
    return this.withLock(async () => {
      // ...and again inside the lock, where two concurrent claims are ordered.
      this.checkLimits(address, ipHash);
      return this.send(address, ipHash);
    });
  }

  private async send(address: string, ipHash: string): Promise<ClaimResult> {
    const { amountSat } = this.opts.settings;
    let utxos: P2wpkhUtxo[];
    let feeRate: number;
    try {
      utxos = await this.spendable();
      feeRate = await this.feeRate();
    } catch (e) {
      throw this.upstream(e);
    }

    let payment;
    try {
      payment = buildP2wpkhPayment({
        utxos,
        to: address,
        amountSat,
        feeRate,
        signer: this.opts.wallet.signer,
        network: btc.networks.testnet,
      });
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        this.log(JSON.stringify({ evt: "faucet_empty", availableSat: e.availableSat, requiredSat: e.requiredSat }));
        throw new FaucetError("faucet_empty", "the faucet does not hold enough Signet BTC right now");
      }
      throw e;
    }

    let txid: string;
    try {
      txid = await this.opts.esplora.broadcastTx(payment.txHex);
    } catch (e) {
      if (e instanceof EsploraError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        this.log(JSON.stringify({ evt: "faucet_broadcast_rejected", status: e.status, body: e.body.slice(0, 200) }));
        throw new FaucetError("broadcast_rejected", "the Signet node rejected the faucet transaction; try again shortly");
      }
      // Unknown outcome (timeout, 5xx): the transaction may be in the mempool,
      // so keep its inputs out of the next selection rather than conflict with it.
      this.reserve(payment.inputs);
      throw this.upstream(e);
    }
    if (txid !== payment.txid) {
      this.log(JSON.stringify({ evt: "faucet_txid_mismatch", expected: payment.txid, got: txid.slice(0, 80) }));
      txid = payment.txid;
    }

    this.reserve(payment.inputs);
    if (payment.changeSat > 0) {
      this.pendingChange.push({ txid, vout: 1, value: payment.changeSat, expiresAt: this.now() + RESERVATION_TTL_MS });
    }
    this.balanceCache = undefined;

    const createdAt = this.now();
    try {
      this.opts.store.record({ address, ipHash, txid, amountSat, createdAt });
    } catch (e) {
      // The coins are sent; failing the response now would only invite a retry.
      this.log(JSON.stringify({ evt: "faucet_record_failed", txid, message: (e as Error).message }));
    }

    const remainingSat = utxos.reduce((s, u) => s + u.value, 0) - amountSat - payment.feeSat;
    const claimsLeft = Math.floor(remainingSat / (amountSat + payment.feeSat));
    this.log(JSON.stringify({ evt: "faucet_paid", txid, amountSat, feeSat: payment.feeSat, claimsLeft }));
    if (claimsLeft < LOW_BALANCE_CLAIMS) {
      console.warn(JSON.stringify({ evt: "faucet_low_balance", address: this.address, remainingSat, claimsLeft }));
    }

    return { txid, address, amountSats: amountSat, feeSats: payment.feeSat };
  }

  private reserve(inputs: P2wpkhUtxo[]): void {
    const exp = this.now() + RESERVATION_TTL_MS;
    for (const u of inputs) this.reserved.set(outpoint(u), exp);
    const spent = new Set(inputs.map(outpoint));
    this.pendingChange = this.pendingChange.filter((c) => !spent.has(outpoint(c)));
  }

  private upstream(e: unknown): FaucetError {
    const message = e instanceof Error ? e.message : String(e);
    this.log(JSON.stringify({ evt: "faucet_upstream_error", unavailable: isUpstreamUnavailable(e), message }));
    return new FaucetError("upstream_unavailable", "the Bitcoin Signet API is unavailable; try again shortly", 30);
  }

  async status(): Promise<FaucetStatus> {
    const t = this.now();
    const { amountSat, dailyCap, cooldownMs, ipClaimsPerWindow, ipWindowMs, minFeeRate } = this.opts.settings;
    const dayStart = startOfUtcDay(t);
    const claimsToday = this.opts.store.countSince(dayStart);

    let balanceSats: number | null = null;
    if (this.balanceCache && t - this.balanceCache.at < BALANCE_CACHE_MS) {
      balanceSats = this.balanceCache.sats;
    } else {
      try {
        balanceSats = (await this.spendable()).reduce((s, u) => s + u.value, 0);
        this.balanceCache = { at: t, sats: balanceSats };
      } catch {
        balanceSats = null;
      }
    }
    // Per-claim cost at the fee floor for a one-input, two-output payment.
    const perClaim = amountSat + Math.ceil(estimateP2wpkhVsize(1, [Buffer.alloc(34), Buffer.alloc(22)]) * minFeeRate);

    return {
      enabled: true,
      network: "signet",
      address: this.address,
      amountSats: amountSat,
      dailyCap,
      claimsToday,
      remainingToday: Math.max(0, dailyCap - claimsToday),
      resetsAt: new Date(dayStart + 86_400_000).toISOString(),
      cooldownHours: cooldownMs / 3_600_000,
      ipClaimsPerWindow,
      ipWindowHours: ipWindowMs / 3_600_000,
      balanceSats,
      claimsLeftAtBalance: balanceSats === null ? null : Math.floor(balanceSats / perClaim),
    };
  }
}
