import { describe, expect, test } from "bun:test";
import { SignetFaucetError } from "@/lib/faucet/claim";
import { BTC_FAUCETS } from "@/lib/links";
import { describeClaimError, isFunded, runAutoClaim, type AutoClaimDeps, type ClaimState, type SavedClaim } from "./autoClaim";

const TXID = "ab".repeat(32);
const PAID = { txid: TXID, explorerUrl: `https://mempool.space/signet/tx/${TXID}`, amountSats: 20_000 };
const DASHES = [0x2013, 0x2014].map((c) => String.fromCharCode(c));

function deps(over: Partial<AutoClaimDeps> & { confirmations?: boolean[] } = {}) {
  let saved: SavedClaim | null = null;
  const confirmations = [...(over.confirmations ?? [true])];
  const calls = { claim: 0, sleep: 0 };
  const d: AutoClaimDeps = {
    balance: async () => 0,
    claim: async () => {
      calls.claim += 1;
      return PAID;
    },
    confirmed: async () => confirmations.shift() ?? true,
    saved: { get: () => saved, set: (c) => (saved = c) },
    sleep: async () => {
      calls.sleep += 1;
    },
    ...over,
  };
  return { d, calls, saved: () => saved };
}

async function run(d: AutoClaimDeps, signal?: AbortSignal) {
  const states: ClaimState["kind"][] = [];
  const end = await runAutoClaim(d, (s) => states.push(s.kind), signal);
  return { end, states };
}

describe("runAutoClaim", () => {
  test("an empty key claims, saves the payout and follows it to one confirmation", async () => {
    const { d, calls, saved } = deps({ confirmations: [false, false, true] });
    const { end, states } = await run(d);
    expect(states).toEqual(["checking", "claiming", "sent", "confirmed"]);
    expect(end).toEqual({ kind: "confirmed", ...PAID });
    expect(calls.claim).toBe(1);
    expect(calls.sleep).toBe(2);
    expect(saved()).toEqual(PAID);
  });

  test("a funded key never claims", async () => {
    const { d, calls } = deps({ balance: async () => 12_345 });
    const { end, states } = await run(d);
    expect(states).toEqual(["checking", "funded"]);
    expect(end).toEqual({ kind: "funded", sats: 12_345 });
    expect(calls.claim).toBe(0);
  });

  test("a reload resumes a saved payout without claiming again", async () => {
    const { d, calls } = deps({ confirmations: [false, true] });
    d.saved.set(PAID);
    const { states } = await run(d);
    expect(states).toEqual(["sent", "confirmed"]);
    expect(calls.claim).toBe(0);
  });

  test("an unreadable balance still claims; the faucet refuses a second payout itself", async () => {
    const { d, calls } = deps({
      balance: async () => {
        throw new Error("esplora down");
      },
    });
    const { end } = await run(d);
    expect(end.kind).toBe("confirmed");
    expect(calls.claim).toBe(1);
  });

  test("a failed status read keeps waiting", async () => {
    let n = 0;
    const { d } = deps({
      confirmed: async () => {
        n += 1;
        if (n === 1) throw new Error("timeout");
        return true;
      },
    });
    expect((await run(d)).end.kind).toBe("confirmed");
  });

  test("a refusal ends in failed with the public faucets", async () => {
    const { d } = deps({
      claim: async () => {
        throw new SignetFaucetError("faucet_empty", "empty", 503, undefined, ["https://signetfaucet.com"]);
      },
    });
    const { end, states } = await run(d);
    expect(states).toEqual(["checking", "claiming", "failed"]);
    expect(end.kind === "failed" && end.failure).toMatchObject({ code: "faucet_empty", title: "Faucet empty", publicFaucets: ["https://signetfaucet.com"] });
  });

  test("stops reporting once aborted", async () => {
    const controller = new AbortController();
    const { d } = deps({
      balance: async () => {
        controller.abort();
        return 0;
      },
    });
    const { states } = await run(d, controller.signal);
    expect(states).toEqual(["checking"]);
  });
});

describe("describeClaimError", () => {
  const err = (code: string, status = 400, extra: { retryAfterSeconds?: number; faucets?: string[] } = {}) =>
    new SignetFaucetError(code, "x", status, extra.retryAfterSeconds, extra.faucets ?? []);

  test.each([
    ["faucet_disabled", "Faucet off", false],
    ["faucet_empty", "Faucet empty", true],
    ["daily_cap_reached", "Daily limit reached", true],
    ["account_already_claimed", "Already funded once", false],
    ["stellar_address_already_claimed", "Already funded once", false],
    ["signet_address_already_claimed", "Already funded once", false],
    ["login_check_unavailable", "Sign-in check unavailable", true],
    ["login_expired", "Sign-in expired", true],
    ["login_invalid", "Sign-in expired", true],
    ["login_provider_not_allowed", "Not for email sign-in", false],
    ["login_not_social", "Not for email sign-in", false],
    ["upstream_unavailable", "Try again shortly", true],
    ["rate_limited", "Try again shortly", true],
    ["ip_cooldown", "Try again shortly", true],
    ["network_error", "Faucet unreachable", true],
    ["something_new", "Test BTC not sent", true],
  ])("%s", (code, title, retryable) => {
    const f = describeClaimError(err(code));
    expect(f.code).toBe(code);
    expect(f.title).toBe(title);
    expect(f.retryable).toBe(retryable);
    expect(f.publicFaucets).toEqual(BTC_FAUCETS.map((x) => x.href));
    for (const d of DASHES) expect(f.message.includes(d)).toBe(false);
  });

  test("keeps the relayer's faucet list and retry hint", () => {
    const f = describeClaimError(err("daily_cap_reached", 429, { retryAfterSeconds: 60, faucets: ["https://a.test"] }));
    expect(f.retryAfterSeconds).toBe(60);
    expect(f.publicFaucets).toEqual(["https://a.test"]);
  });

  test("a non-faucet error reads as a generic failure", () => {
    expect(describeClaimError(new Error("boom")).code).toBe("other");
  });
});

test("isFunded", () => {
  expect(isFunded({ kind: "funded", sats: 1 })).toBe(true);
  expect(isFunded({ kind: "sent", ...PAID })).toBe(true);
  expect(isFunded({ kind: "claiming" })).toBe(false);
});
