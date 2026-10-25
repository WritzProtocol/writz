import { beforeEach, describe, expect, test } from "bun:test";
import { markMilestone, milestones, reportStep, resetFunnelCache, subscribeMilestones, type FunnelStorage } from "./funnel";

const G = `G${"A".repeat(55)}`;
const TX = "cd".repeat(32);

function storage(): FunnelStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function relayer(status: number | "down") {
  const bodies: Record<string, unknown>[] = [];
  const fetchMock = (async (url: string, init?: RequestInit) => {
    expect(url).toBe("https://relayer.test/metrics/onboarding/events");
    bodies.push(JSON.parse(String(init?.body)));
    if (status === "down") throw new TypeError("fetch failed");
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { fetchMock, bodies };
}

beforeEach(resetFunnelCache);

describe("milestones", () => {
  test("marks the first time only, persists, and notifies", () => {
    const s = storage();
    let notified = 0;
    const off = subscribeMilestones(() => (notified += 1));
    markMilestone(G, "sign_in", s, 10);
    markMilestone(G, "sign_in", s, 20);
    off();
    expect(milestones(G, s)).toEqual({ sign_in: 10 });
    expect(notified).toBe(1);
    resetFunnelCache();
    expect(milestones(G, s)).toEqual({ sign_in: 10 });
  });

  test("works without storage", () => {
    markMilestone(G, "deposit", null, 5);
    expect(milestones(G, null)).toEqual({ deposit: 5 });
  });
});

describe("reportStep", () => {
  test("sends the step once, with the address, channel and txid only", async () => {
    const s = storage();
    const r = relayer(202);
    const deps = { relayerUrl: "https://relayer.test/", storage: s, fetch: r.fetchMock, now: () => 7 };
    expect(await reportStep("deposit", { stellarAddress: G, channel: "social", txid: TX }, deps)).toBe(true);
    expect(await reportStep("deposit", { stellarAddress: G, channel: "social", txid: TX }, deps)).toBe(true);
    expect(r.bodies).toEqual([{ step: "deposit", stellarAddress: G, channel: "social", txid: TX }]);
    expect(milestones(G, s)).toEqual({ deposit: 7 });
  });

  test("retries after a network error, a 5xx, a 429 or a 422", async () => {
    for (const status of ["down", 503, 429, 422] as const) {
      resetFunnelCache();
      const s = storage();
      const r = relayer(status);
      const deps = { relayerUrl: "https://relayer.test", storage: s, fetch: r.fetchMock };
      expect(await reportStep("borrow", { stellarAddress: G, channel: "wallet", txid: TX }, deps)).toBe(false);
      await reportStep("borrow", { stellarAddress: G, channel: "wallet", txid: TX }, deps);
      expect(r.bodies).toHaveLength(2);
      expect(milestones(G, s).borrow).toBeGreaterThan(0);
    }
  });

  test("does not resend an event the relayer refused for good", async () => {
    const s = storage();
    const r = relayer(403);
    const deps = { relayerUrl: "https://relayer.test", storage: s, fetch: r.fetchMock };
    expect(await reportStep("repay", { stellarAddress: G, channel: "wallet", txid: TX }, deps)).toBe(false);
    await reportStep("repay", { stellarAddress: G, channel: "wallet", txid: TX }, deps);
    expect(r.bodies).toHaveLength(1);
  });

  test("a loan step without its txid, or no relayer, is only marked locally", async () => {
    const s = storage();
    const r = relayer(202);
    expect(await reportStep("release", { stellarAddress: G, channel: "social" }, { relayerUrl: "https://relayer.test", storage: s, fetch: r.fetchMock })).toBe(false);
    expect(await reportStep("sign_in", { stellarAddress: G, channel: "social" }, { relayerUrl: "", storage: s, fetch: r.fetchMock })).toBe(false);
    expect(r.bodies).toHaveLength(0);
    expect(Object.keys(milestones(G, s)).sort()).toEqual(["release", "sign_in"]);
  });
});
