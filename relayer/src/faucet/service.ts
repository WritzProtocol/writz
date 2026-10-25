/**
 * Writz Signet faucet: pays a fixed amount of Signet test BTC from a
 * relayer-held P2WPKH hot wallet to accounts created through the Writz
 * testnet app's social login, and to nobody else. It is not a public faucet:
 * builders use the public Signet faucets (`PUBLIC_SIGNET_FAUCETS`).
 *
 * A claim carries the Pollar access token of the user's session, their
 * Stellar address, their Signet address and public key, and a BIP-137
 * signature by that key over a relayer-issued, single-use nonce bound to both
 * addresses. The relayer checks the signature and that the Signet address is
 * the key's P2WPKH, then asks Pollar whether the token is a live testnet
 * social login of the Writz app whose wallet is that Stellar address.
 *
 * The coins have no value; the realistic harm is a drained faucet that stops
 * working for the next person. Hence: a fixed amount; one claim ever per
 * Pollar account, per Stellar address and per Signet address; a number of
 * claims per client IP per sliding window (sized so a venue or a classroom
 * behind one IP can onboard its people in one session); a global cap per UTC
 * day; and a balance check that fails closed with `faucet_empty`.
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
  verifyBitcoinMessage,
} from "@writz/bitcoin-script";
import { EsploraError, isUpstreamUnavailable, type AddressUtxo } from "../bitcoin/esplora.js";
import type { ClaimStore } from "./store.js";
import type { LoginVerifier } from "./pollar.js";
import { faucetClaimMessage, NonceBook, type IssuedNonce } from "./nonce.js";

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
  /** Checks the Pollar login a claim presents (`pollar.ts`). */
  verifier: LoginVerifier;
  nonces?: NonceBook;
  now?: () => number;
  log?: (line: string) => void;
}

export type FaucetErrorCode =
  | "invalid_request"
  | "invalid_address"
  | "faucet_address"
  | "nonce_invalid"
  | "address_key_mismatch"
  | "bad_signature"
  | "login_expired"
  | "login_invalid"
  | "login_wrong_app"
  | "login_wrong_network"
  | "login_not_social"
  | "login_address_mismatch"
  | "login_provider_not_allowed"
  | "login_check_unavailable"
  | "account_already_claimed"
  | "stellar_address_already_claimed"
  | "signet_address_already_claimed"
  | "ip_cooldown"
  | "daily_cap_reached"
  | "faucet_empty"
  | "upstream_unavailable"
  | "broadcast_rejected";

const HTTP_STATUS: Record<FaucetErrorCode, number> = {
  invalid_request: 400,
  invalid_address: 400,
  faucet_address: 400,
  nonce_invalid: 400,
  address_key_mismatch: 400,
  bad_signature: 400,
  login_expired: 401,
  login_invalid: 401,
  login_wrong_app: 403,
  login_wrong_network: 403,
  login_not_social: 403,
  login_address_mismatch: 403,
  login_provider_not_allowed: 403,
  login_check_unavailable: 503,
  account_already_claimed: 409,
  stellar_address_already_claimed: 409,
  signet_address_already_claimed: 409,
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

/** The body of POST /faucet/signet. */
export interface ClaimRequest {
  /** The SDK access token of the user's Pollar session. */
  pollarAccessToken: string;
  /** The G-address of the user's Pollar wallet. */
  stellarAddress: string;
  /** The P2WPKH Signet address of `signetPubkey` (tb1q...). */
  signetAddress: string;
  /** 33-byte compressed public key, hex. */
  signetPubkey: string;
  /** From GET /faucet/signet/nonce. */
  nonce: string;
  /** Base64 BIP-137 signature by `signetPubkey` over `faucetClaimMessage(nonce, stellarAddress, signetAddress)`. */
  keySig: string;
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
  /** Who can claim: accounts created through the Writz testnet app's social login. */
  access: "testnet_app_social_login";
  message: string;
  /** The faucet's own address, public on chain (donations welcome). */
  address: string;
  amountSats: number;
  dailyCap: number;
  remainingToday: number;
  resetsAt: string;
  /** False when the balance does not cover one more claim, null if Esplora is unavailable. */
  funded: boolean | null;
  publicFaucets: string[];
}

export const SOCIAL_LOGIN_ONLY_MESSAGE =
  "The Writz Signet faucet only funds accounts created through the Writz testnet app's social login, " +
  "once per account. Builders: use a public Signet faucet.";

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

/** Who a claim pays: the Signet address, the Stellar address, and the hashed Pollar account once verified. */
interface Claimant {
  address: string;
  stellarAddress: string;
  userKey?: string;
}

const STELLAR_ACCOUNT = /^G[A-Z2-7]{55}$/;
const NONCE_FORMAT = /^[0-9a-f]{32}$/;
const PUBKEY_HEX = /^0[23][0-9a-fA-F]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$/;
/** Pollar access tokens are JWTs well under this; anything longer is not one. */
const MAX_TOKEN_LENGTH = 8_192;

/** Validates the shape of a POST /faucet/signet body; the checks that need keys or Pollar come after. */
export function parseClaimRequest(body: unknown): ClaimRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const bad = (message: string) => new FaucetError("invalid_request", message);
  const str = (k: keyof ClaimRequest): string => {
    const v = b[k];
    if (typeof v !== "string" || v.trim() === "") throw bad(`${k} is required`);
    return v.trim();
  };
  const pollarAccessToken = str("pollarAccessToken");
  if (pollarAccessToken.length > MAX_TOKEN_LENGTH) throw bad("pollarAccessToken is too long");
  const stellarAddress = str("stellarAddress");
  if (!STELLAR_ACCOUNT.test(stellarAddress)) throw bad("stellarAddress must be a Stellar account address (G...)");
  const signetAddress = str("signetAddress");
  const signetPubkey = str("signetPubkey");
  if (!PUBKEY_HEX.test(signetPubkey)) throw bad("signetPubkey must be a 33-byte compressed public key in hex");
  const nonce = str("nonce");
  if (!NONCE_FORMAT.test(nonce)) throw bad("nonce must come from GET /faucet/signet/nonce");
  const keySig = str("keySig");
  if (!BASE64.test(keySig)) throw bad("keySig must be a base64 BIP-137 signature (65 bytes)");
  return { pollarAccessToken, stellarAddress, signetAddress, signetPubkey: signetPubkey.toLowerCase(), nonce, keySig };
}

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
  private readonly nonces: NonceBook;

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
    this.nonces = opts.nonces ?? new NonceBook(this.now);
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

  /** Refuses an account, a Stellar address or a Signet address that already claimed, then the IP and daily limits. */
  private checkLimits(claimant: Claimant, ipHash: string): void {
    const t = this.now();
    const { ipClaimsPerWindow, ipWindowMs, dailyCap } = this.opts.settings;
    const { store } = this.opts;
    if (claimant.userKey !== undefined && store.hasClaimForUser(claimant.userKey)) {
      throw new FaucetError("account_already_claimed", "this account has already received its Signet coins");
    }
    if (store.hasClaimForStellarAddress(claimant.stellarAddress)) {
      throw new FaucetError("stellar_address_already_claimed", "this Stellar address has already received Signet coins");
    }
    if (store.hasClaimForAddress(claimant.address)) {
      throw new FaucetError("signet_address_already_claimed", "this Signet address has already received coins from the faucet");
    }
    // Claims strictly inside the window (t - ipWindowMs, t]: one made exactly
    // ipWindowMs ago has left it.
    const ipClaims = store.ipClaimsSince(ipHash, t - ipWindowMs + 1);
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
    if (store.countSince(dayStart) >= dailyCap) {
      throw new FaucetError(
        "daily_cap_reached",
        "the faucet has paid its daily maximum; it resets at 00:00 UTC",
        Math.ceil((dayStart + 86_400_000 - t) / 1000),
      );
    }
  }

  /** A single-use challenge for the next claim (GET /faucet/signet/nonce). */
  issueNonce(): IssuedNonce {
    return this.nonces.issue();
  }

  /**
   * Pays the configured amount to the Signet address of a social-login
   * account, once. `body` is the untrusted request body (`ClaimRequest`);
   * `ip` is the caller's address as Express resolved it.
   *
   * Order: shape, nonce (spent here whatever happens next), key control,
   * then the cheap one-claim and limit checks, and only then the Pollar
   * call, so a refused or replayed request costs no Server API request.
   */
  async claim(body: unknown, ip: string): Promise<ClaimResult> {
    const req = parseClaimRequest(body);
    if (!this.nonces.consume(req.nonce)) {
      throw new FaucetError("nonce_invalid", "the claim challenge is unknown, expired or already used; request a new one");
    }

    const address = normalizeSignetAddress(req.signetAddress);
    if (address === this.address) throw new FaucetError("faucet_address", "that is the faucet's own address");
    const pubkey = Buffer.from(req.signetPubkey, "hex");
    let derived: string;
    try {
      derived = pubkeyToP2WPKHAddress(pubkey, btc.networks.testnet);
    } catch {
      throw new FaucetError("address_key_mismatch", "signetPubkey is not a valid compressed public key");
    }
    if (derived !== address) {
      throw new FaucetError("address_key_mismatch", "signetAddress is not the P2WPKH address of signetPubkey");
    }
    if (!verifyBitcoinMessage(faucetClaimMessage(req.nonce, req.stellarAddress, address), req.keySig, pubkey)) {
      throw new FaucetError("bad_signature", "keySig is not a signature by signetPubkey over this claim");
    }

    const ipHash = hashIp(ip);
    // Checked before the Pollar call and before queueing, so a refused caller
    // costs nothing and never waits behind a send...
    this.checkLimits({ address, stellarAddress: req.stellarAddress }, ipHash);
    const login = await this.opts.verifier.verify(req.pollarAccessToken, req.stellarAddress);
    const claimant: Claimant = { address, stellarAddress: login.stellarAddress, userKey: login.userKey };
    this.checkLimits(claimant, ipHash);
    return this.withLock(async () => {
      // ...and again inside the lock, where two concurrent claims are ordered.
      this.checkLimits(claimant, ipHash);
      return this.send(claimant as Required<Claimant>, ipHash);
    });
  }

  private async send(claimant: Required<Claimant>, ipHash: string): Promise<ClaimResult> {
    const { address } = claimant;
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
      this.opts.store.record({
        address,
        ipHash,
        userKey: claimant.userKey,
        stellarAddress: claimant.stellarAddress,
        txid,
        amountSat,
        createdAt,
      });
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
    const { amountSat, dailyCap, minFeeRate } = this.opts.settings;
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
      access: "testnet_app_social_login",
      message: SOCIAL_LOGIN_ONLY_MESSAGE,
      address: this.address,
      amountSats: amountSat,
      dailyCap,
      remainingToday: Math.max(0, dailyCap - claimsToday),
      resetsAt: new Date(dayStart + 86_400_000).toISOString(),
      funded: balanceSats === null ? null : balanceSats >= perClaim,
      publicFaucets: PUBLIC_SIGNET_FAUCETS,
    };
  }
}
