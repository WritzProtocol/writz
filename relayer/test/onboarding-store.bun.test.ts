import { describe, test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { openSqliteFunnelStore } from "../src/onboarding/sqlite-store.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "writz-onboarding-")), "onboarding.db");
const row = (subject: string, step: string, createdAt: number, outcome = "ok") => ({
  subject,
  step,
  outcome,
  channel: "social",
  verified: step !== "sign_in",
  createdAt,
});

describe("sqlite onboarding funnel store", () => {
  test("keeps one row per subject, step and outcome, and survives a reopen", () => {
    const file = tmp();
    const a = openSqliteFunnelStore(file);
    expect(a.record(row("s1", "sign_in", 2))).toBe(true);
    expect(a.record(row("s1", "sign_in", 3))).toBe(false);
    expect(a.record(row("s1", "faucet_claim", 1, "paid"))).toBe(true);
    expect(a.record(row("s1", "faucet_claim", 4, "faucet_empty"))).toBe(true);

    const b = openSqliteFunnelStore(file);
    expect(b.rows().map((r) => [r.step, r.outcome, r.createdAt, r.verified])).toEqual([
      ["faucet_claim", "paid", 1, true],
      ["sign_in", "ok", 2, false],
      ["faucet_claim", "faucet_empty", 4, true],
    ]);
  });

  test("creates the subject secret once and keeps it", () => {
    const file = tmp();
    const a = openSqliteFunnelStore(file).secret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(openSqliteFunnelStore(file).secret()).toBe(a);
    expect(openSqliteFunnelStore(tmp()).secret()).not.toBe(a);
  });
});
