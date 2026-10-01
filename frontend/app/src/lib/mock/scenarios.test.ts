import { describe, expect, test } from "bun:test";
import { derivePositionStatus } from "@/lib/status/derive";
import { readStatusInputs } from "@/lib/status/source";
import { MIN_CONFIRMATIONS } from "./fixtures";
import { mockEnabled, scenarioFromSearch } from "./gate";
import { SCENARIOS, getScenario } from "./scenarios";
import { mockStatusSource } from "./source";
import type { MockWorld } from "./types";

const NOW = 1_800_000_000_000;

const range = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

const LIFECYCLE = [
  "draft",
  "preparing",
  "awaiting_signature",
  "signature_cancelled",
  "submitted",
  "confirming",
  "confirmed",
  "timed_out",
  "failed",
  "needs_attention",
];

const STATUS_ROWS = [
  "checking",
  "btc_sent",
  "btc_unseen",
  "confirming",
  "ready_to_register",
  "proving",
  "registering",
  "register_failed",
  "active",
  "at_risk",
  "liquidatable",
  "repaid_locked",
  "releasing",
  "released",
  "liquidated",
  "changed_elsewhere",
  "reclaimable",
  "syncing",
];

/** ux-spec Appendix A. */
const APPENDIX_A = [
  ...range("G", 7),
  ...range("H", 21),
  ...range("B", 37),
  ...range("L", 25),
  ...range("E", 11),
  ...range("N", 19),
  ...range("P", 5),
  ...range("R", 4),
  ...LIFECYCLE.map((id) => `tx.${id}`),
  ...STATUS_ROWS.map((id) => `status.${id}`),
];

async function derived(world: MockWorld) {
  const source = mockStatusSource(world);
  return Promise.all(
    world.positions.map(async (p) =>
      derivePositionStatus(await readStatusInputs(p.local, source, { minConfirmations: MIN_CONFIRMATIONS, now: NOW })),
    ),
  );
}

describe("mock scenarios", () => {
  test("cover every Appendix A state ID exactly once", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...APPENDIX_A].sort());
    expect(APPENDIX_A.filter((id) => !id.includes(".")).length).toBe(129);
  });

  for (const scenario of SCENARIOS) {
    test(`${scenario.id} derives the status its fixtures declare`, async () => {
      const world = scenario.build(NOW);
      const results = await derived(world);
      world.positions.forEach((p, i) => {
        expect(results[i].status.kind).toBe(p.expect);
        expect(results[i].reclaimable).toBe(Boolean(p.reclaimable));
        expect(results[i].syncing).toBe(Boolean(p.syncing));
      });
    });
  }

  test("each status row scenario produces that status or overlay", async () => {
    for (const row of STATUS_ROWS) {
      const [d] = await derived(getScenario(`status.${row}`)!.build(NOW));
      const shown = row === "reclaimable" ? d.reclaimable : row === "syncing" ? d.syncing : d.status.kind === row;
      expect(shown).toBe(true);
    }
  });

  test("each lifecycle scenario carries that lifecycle state", () => {
    for (const id of LIFECYCLE) expect(getScenario(`tx.${id}`)!.build(NOW).flow?.lifecycle).toBe(id as never);
  });

  test("an unreachable Stellar RPC turns an open loan into checking, never a stale status", async () => {
    const [d] = await derived(getScenario("G4")!.build(NOW));
    expect(d.status).toEqual({ kind: "checking", missing: ["nullifier"] });
  });
});

describe("mock gate", () => {
  test("on only with the flag set and never on mainnet", () => {
    expect(mockEnabled("1", "testnet")).toBe(true);
    expect(mockEnabled("1", "local")).toBe(true);
    expect(mockEnabled("1", "mainnet")).toBe(false);
    expect(mockEnabled(undefined, "local")).toBe(false);
    expect(mockEnabled("true", "local")).toBe(false);
  });

  test("selects a known scenario from the query only while enabled", () => {
    expect(scenarioFromSearch("?scenario=H6", true)?.id).toBe("H6");
    expect(scenarioFromSearch("?scenario=H6", false)).toBeNull();
    expect(scenarioFromSearch("?scenario=nope", true)).toBeNull();
    expect(scenarioFromSearch("", true)).toBeNull();
  });
});
