/**
 * The testnet onboarding funnel: how many people signed in, got a Signet test
 * key, were paid by the faucet, deposited, borrowed, repaid and released.
 *
 * Privacy: a person is a subject, the HMAC of their Stellar address under a
 * secret kept in the store. No address, Pollar id, email, profile or IP is
 * stored, and the summary only returns counts.
 *
 * Trust: each row says whether the relayer checked it.
 *   - `faucet_claim` rows are written by the faucet route itself, with the
 *     outcome of the claim; a `paid` claim was verified with Pollar as a live
 *     social login of this app whose wallet is that Stellar address.
 *   - `deposit`, `borrow`, `repay` and `release` are reported by the app with
 *     the loan's Bitcoin deposit txid; the relayer reads that position on
 *     `writz-lend` and records the step only if the reporting address is its
 *     depositor and the position is in a state the step implies.
 *   - `sign_in` and `key_created` happen in the browser and are recorded as
 *     reported, unverified.
 *
 * The headline (product spec 1.2): activated social-login users, the
 * subjects with a paid faucet claim, a verified deposit and a verified
 * borrow. Totals count every address, team wallets included.
 */
import { createHmac } from "crypto";
import type { FunnelRow, FunnelStore } from "./store.js";

/** Steps the app reports, in funnel order. */
export const REPORTED_STEPS = ["sign_in", "key_created", "deposit", "borrow", "repay", "release"] as const;
export type ReportedStep = (typeof REPORTED_STEPS)[number];
/** Steps the relayer checks against the loan on `writz-lend` before recording. */
export const CHAIN_STEPS: ReadonlySet<string> = new Set(["deposit", "borrow", "repay", "release"]);
/** Every step of the summary, in funnel order. */
export const FUNNEL_STEPS = ["sign_in", "key_created", "faucet_paid", "deposit", "borrow", "repay", "release"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export type Channel = "social" | "wallet";

/** What the funnel needs to know about a `writz-lend` position. */
export interface PositionFacts {
  depositor: string;
  status: "active" | "closed" | "liquidated";
  debtStroops: bigint;
}

/** Reads a position by its Bitcoin deposit txid in display order; null when writz-lend holds none. */
export type PositionReader = (txidDisplay: string) => Promise<PositionFacts | null>;

export type FunnelErrorCode =
  | "invalid_request"
  | "not_on_chain"
  | "not_owner"
  | "step_not_reached"
  | "chain_unavailable"
  | "not_configured";

const HTTP: Record<FunnelErrorCode, number> = {
  invalid_request: 400,
  not_on_chain: 422,
  not_owner: 403,
  step_not_reached: 422,
  chain_unavailable: 503,
  not_configured: 503,
};

export class FunnelError extends Error {
  readonly httpStatus: number;
  constructor(
    readonly code: FunnelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FunnelError";
    this.httpStatus = HTTP[code];
  }
}

const STELLAR_ACCOUNT = /^G[A-Z2-7]{55}$/;
const TXID = /^[0-9a-f]{64}$/i;

export interface StepReport {
  step: ReportedStep;
  stellarAddress: string;
  channel: Channel;
  /** The loan's Bitcoin deposit txid (display order); required for the chain steps. */
  txid?: string;
}

/** Validates the body of POST /metrics/onboarding/events. */
export function parseStepReport(body: unknown): StepReport {
  const b = (body ?? {}) as Record<string, unknown>;
  const bad = (m: string) => new FunnelError("invalid_request", m);
  if (typeof b.step !== "string" || !(REPORTED_STEPS as readonly string[]).includes(b.step)) {
    throw bad(`step must be one of ${REPORTED_STEPS.join(", ")}`);
  }
  if (typeof b.stellarAddress !== "string" || !STELLAR_ACCOUNT.test(b.stellarAddress)) {
    throw bad("stellarAddress must be a Stellar account address (G...)");
  }
  const channel = b.channel === undefined ? "wallet" : b.channel;
  if (channel !== "social" && channel !== "wallet") throw bad("channel must be social or wallet");
  const step = b.step as ReportedStep;
  let txid: string | undefined;
  if (CHAIN_STEPS.has(step)) {
    if (typeof b.txid !== "string" || !TXID.test(b.txid)) throw bad(`${step} needs the loan's Bitcoin deposit txid`);
    txid = b.txid.toLowerCase();
  }
  return { step, stellarAddress: b.stellarAddress, channel, ...(txid ? { txid } : {}) };
}

/** Whether a position in this state can have gone through `step`. */
export function positionReached(step: string, p: PositionFacts): boolean {
  switch (step) {
    case "deposit":
    case "repay":
      return true;
    case "borrow":
      return p.debtStroops > 0n || p.status !== "active";
    case "release":
      return p.status === "closed";
    default:
      return false;
  }
}

export interface FunnelCounts {
  sign_in: number;
  key_created: number;
  faucet_paid: number;
  deposit: number;
  borrow: number;
  repay: number;
  release: number;
}

export interface OnboardingSummary {
  asOf: string;
  network: "testnet";
  /** The writz-lend contract the chain steps were checked against. */
  contract: string | null;
  headline: {
    /** Social-login users (paid faucet claim) with a verified deposit and a verified borrow. */
    activatedSocialUsers: number;
    /** Social-login users (paid faucet claim) with a verified deposit. */
    socialUsersWithDeposit: number;
  };
  /** Distinct subjects per step, every channel. */
  totals: FunnelCounts;
  /** The same for subjects that signed in with Pollar. */
  social: FunnelCounts;
  /** Distinct subjects per faucet result: "paid" or the refusal code. */
  faucetOutcomes: Record<string, number>;
  /** Distinct subjects per step by the UTC day each first reached it. */
  daily: ({ day: string } & FunnelCounts)[];
  definitions: Record<string, string>;
}

const zero = (): FunnelCounts => ({ sign_in: 0, key_created: 0, faucet_paid: 0, deposit: 0, borrow: 0, repay: 0, release: 0 });

/** The funnel step a stored row counts toward, or null for a faucet refusal. */
function stepOf(row: FunnelRow): FunnelStep | null {
  if (row.step === "faucet_claim") return row.outcome === "paid" ? "faucet_paid" : null;
  return (FUNNEL_STEPS as readonly string[]).includes(row.step) ? (row.step as FunnelStep) : null;
}

export interface OnboardingFunnelOptions {
  store: FunnelStore;
  /** Undefined when this relayer has no writz-lend contract; chain steps then answer 503. */
  readPosition?: PositionReader;
  contractId?: string | null;
  now?: () => number;
}

export class OnboardingFunnel {
  private readonly now: () => number;

  constructor(private readonly opts: OnboardingFunnelOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** The pseudonymous id of a Stellar address in this store. */
  subjectOf(stellarAddress: string): string {
    return createHmac("sha256", this.opts.store.secret()).update(`stellar:${stellarAddress}`).digest("hex");
  }

  /** Records a step the app reports (POST /metrics/onboarding/events). Chain steps are checked first. */
  async report(body: unknown): Promise<{ recorded: boolean; verified: boolean }> {
    const r = parseStepReport(body);
    let verified = false;
    if (CHAIN_STEPS.has(r.step)) {
      const read = this.opts.readPosition;
      if (!read) throw new FunnelError("not_configured", "this relayer does not follow a writz-lend contract");
      let p: PositionFacts | null;
      try {
        p = await read(r.txid!);
      } catch {
        throw new FunnelError("chain_unavailable", "Stellar could not be read right now; try again shortly");
      }
      if (!p) throw new FunnelError("not_on_chain", "writz-lend holds no loan for this deposit");
      if (p.depositor !== r.stellarAddress) throw new FunnelError("not_owner", "this loan belongs to another address");
      if (!positionReached(r.step, p)) throw new FunnelError("step_not_reached", `this loan has not reached ${r.step}`);
      verified = true;
    }
    const recorded = this.opts.store.record({
      subject: this.subjectOf(r.stellarAddress),
      step: r.step,
      outcome: "ok",
      channel: r.channel,
      verified,
      createdAt: this.now(),
    });
    return { recorded, verified };
  }

  /**
   * Records the result of a faucet claim, from the faucet route. `outcome` is
   * "paid" or the refusal code. Only claims that name a valid Stellar address
   * are recorded; anything else is not a person in the funnel.
   */
  recordFaucet(stellarAddress: unknown, outcome: string): void {
    if (typeof stellarAddress !== "string" || !STELLAR_ACCOUNT.test(stellarAddress)) return;
    if (!/^[a-z_]{1,48}$/.test(outcome)) return;
    this.opts.store.record({
      subject: this.subjectOf(stellarAddress),
      step: "faucet_claim",
      outcome,
      channel: "social",
      verified: outcome === "paid",
      createdAt: this.now(),
    });
  }

  summary(): OnboardingSummary {
    const rows = this.opts.store.rows();
    const totals = zero();
    const social = zero();
    const faucetOutcomes: Record<string, number> = {};
    const days = new Map<string, FunnelCounts>();
    const reached = new Map<FunnelStep, Set<string>>();
    const socialSubjects = new Set<string>();
    for (const row of rows) if (row.channel === "social") socialSubjects.add(row.subject);

    for (const row of rows) {
      if (row.step === "faucet_claim") faucetOutcomes[row.outcome] = (faucetOutcomes[row.outcome] ?? 0) + 1;
      const step = stepOf(row);
      if (!step) continue;
      // Chain steps count only once the relayer checked them.
      if (CHAIN_STEPS.has(step) && !row.verified) continue;
      const seen = reached.get(step) ?? new Set<string>();
      if (seen.has(row.subject)) continue;
      seen.add(row.subject);
      reached.set(step, seen);
      totals[step] += 1;
      if (socialSubjects.has(row.subject)) social[step] += 1;
      const day = new Date(row.createdAt).toISOString().slice(0, 10);
      const d = days.get(day) ?? zero();
      d[step] += 1;
      days.set(day, d);
    }

    const paid = reached.get("faucet_paid") ?? new Set<string>();
    const deposited = reached.get("deposit") ?? new Set<string>();
    const borrowed = reached.get("borrow") ?? new Set<string>();
    let withDeposit = 0;
    let activated = 0;
    for (const s of paid) {
      if (!deposited.has(s)) continue;
      withDeposit += 1;
      if (borrowed.has(s)) activated += 1;
    }

    return {
      asOf: new Date(this.now()).toISOString(),
      network: "testnet",
      contract: this.opts.contractId ?? null,
      headline: { activatedSocialUsers: activated, socialUsersWithDeposit: withDeposit },
      totals,
      social,
      faucetOutcomes,
      daily: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, c]) => ({ day, ...c })),
      definitions: {
        subject: "One Stellar address, stored only as an HMAC under a secret kept by this relayer.",
        sign_in: "Reported by the app when a Pollar sign-in has a Stellar wallet. Not verified.",
        key_created: "Reported by the app when it creates a Signet test key in the browser. Not verified.",
        faucet_paid: "The Writz Signet faucet paid this address after Pollar confirmed a live social login of this app.",
        deposit: "Checked on writz-lend: a position for the reported deposit txid whose depositor is this address.",
        borrow: "Checked on writz-lend: that position has debt, or has been repaid or liquidated.",
        repay: "Reported after a repayment and checked on writz-lend: the position belongs to this address.",
        release: "Reported after the Bitcoin release and checked on writz-lend: the position is closed.",
        activatedSocialUsers: "Addresses with faucet_paid, deposit and borrow. Counts every address, team wallets included.",
        socialUsersWithDeposit: "Addresses with faucet_paid and deposit.",
      },
    };
  }
}
