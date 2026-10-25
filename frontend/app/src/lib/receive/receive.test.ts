import { describe, expect, test } from "bun:test";
import { cctpSettled, cctpSteps } from "./cctp";
import { clientTimeline } from "./clientTimeline";
import { parseEvmAddress, receiveOptions } from "./options";
import { stepperView } from "./stepper";
import { formatBp, minOutFor, quoteFresh, type SwapQuote } from "./swap";
import { orderTimeline, timelineRows, type TimelineEvent } from "./timeline";
import type { Position } from "@/lib/position/types";

describe("receiveOptions", () => {
  test("USDC on Stellar is always offered, the others only when wired", () => {
    expect(receiveOptions({ swap: false, cctp: false, eurc: false }).map((o) => o.id)).toEqual(["usdc"]);
    expect(receiveOptions({ swap: true, cctp: true, eurc: false }).map((o) => o.id)).toEqual(["usdc", "xlm", "base"]);
  });

  test("EURC stays hidden unless its flag is on", () => {
    expect(receiveOptions({ swap: true, cctp: true, eurc: false }).some((o) => o.id === "eurc")).toBe(false);
    expect(receiveOptions({ swap: false, cctp: false, eurc: true }).map((o) => o.id)).toEqual(["usdc", "eurc"]);
  });

  test("every option names a testnet network", () => {
    for (const o of receiveOptions({ swap: true, cctp: true, eurc: true })) expect(o.network).toMatch(/testnet/);
  });
});

describe("parseEvmAddress", () => {
  test("accepts a valid EIP-55 checksummed address", () => {
    const r = parseEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
    expect(r).toEqual({ ok: true, address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" });
  });

  test("accepts all lower or all upper case, which carry no checksum", () => {
    expect(parseEvmAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed").ok).toBe(true);
    expect(parseEvmAddress(" 0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED ").ok).toBe(true);
  });

  test("rejects a mixed-case address with a wrong checksum", () => {
    const r = parseEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/checksum/);
  });

  test("rejects empty, short, non-hex and zero addresses", () => {
    for (const v of ["", "0x123", "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xZZaeb6053f3e94c9b9a09f33669435e7ef1beaed"]) {
      expect(parseEvmAddress(v).ok).toBe(false);
    }
    const zero = parseEvmAddress("0x" + "0".repeat(40));
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toMatch(/zero address/);
  });
});

describe("swap quote", () => {
  const q = (quotedAt: number): SwapQuote => ({ amountInStroops: 1n, amountOutStroops: 1n, minOutStroops: 1n, slippageBp: 100, quotedAt });

  test("minimum output takes the slippage off, rounding down", () => {
    expect(minOutFor(1_000_000_000n, 100)).toBe(990_000_000n);
    expect(minOutFor(999n, 50)).toBe(994n);
  });

  test("a quote is fresh only within its age limit", () => {
    expect(quoteFresh(q(1_000), 1_000 + 15_000)).toBe(true);
    expect(quoteFresh(q(1_000), 1_000 + 15_001)).toBe(false);
    expect(quoteFresh(q(5_000), 1_000)).toBe(false);
  });

  test("slippage reads as a percentage", () => {
    expect(formatBp(100)).toBe("1%");
    expect(formatBp(50)).toBe("0.5%");
    expect(formatBp(25)).toBe("0.25%");
  });
});

describe("stepperView", () => {
  test("step 1 runs first, step 2 waits", () => {
    expect(stepperView("todo", { kind: "idle" })).toEqual({ steps: ["todo", "todo"], active: 1, recovery: false });
    expect(stepperView("running", { kind: "idle" })).toEqual({ steps: ["running", "todo"], active: 1, recovery: false });
  });

  test("a failed borrow stops before step 2 and offers no recovery", () => {
    expect(stepperView("failed", { kind: "idle" })).toEqual({ steps: ["failed", "todo"], active: null, recovery: false });
  });

  test("after the borrow, step 2 is active while it quotes and signs", () => {
    expect(stepperView("done", { kind: "quoted", quote: {} })).toEqual({ steps: ["done", "todo"], active: 2, recovery: false });
    expect(stepperView("done", { kind: "signing" }).steps).toEqual(["done", "running"]);
  });

  test("a failed or skipped step 2 is the recovery state", () => {
    expect(stepperView("done", { kind: "failed", error: new Error("x") })).toEqual({ steps: ["done", "failed"], active: 2, recovery: true });
    expect(stepperView("done", { kind: "skipped" })).toEqual({ steps: ["done", "skipped"], active: 2, recovery: true });
  });

  test("both done ends the stepper", () => {
    expect(stepperView("done", { kind: "done", hash: "h" })).toEqual({ steps: ["done", "done"], active: null, recovery: false });
  });
});

describe("cctpSteps", () => {
  test("sent, then Circle confirming, then arrived with the Base Sepolia transaction", () => {
    expect(cctpSteps("b", null).map((s) => s.state)).toEqual(["done", "now", "next"]);
    expect(cctpSteps("b", { kind: "confirming" }).map((s) => s.state)).toEqual(["done", "now", "next"]);
    const arrived = cctpSteps("b", { kind: "arrived", mintHash: "m" });
    expect(arrived.map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(arrived[0]!.tx).toEqual({ chain: "stellar", hash: "b" });
    expect(arrived[2]!.tx).toEqual({ chain: "base-sepolia", hash: "m" });
  });

  test("labels stay in plain language", () => {
    const labels = cctpSteps("b", { kind: "arrived", mintHash: "m" }).map((s) => s.label);
    expect(labels).toEqual(["Sent from Stellar", "Circle confirms", "Arrived"]);
    expect(labels.join(" ").toLowerCase()).not.toContain("attestation");
  });

  test("a failure marks the Circle step and stops polling", () => {
    expect(cctpSteps("b", { kind: "failed", reason: "r" })[1]!.state).toBe("failed");
    expect(cctpSettled({ kind: "failed", reason: "r" })).toBe(true);
    expect(cctpSettled({ kind: "confirming" })).toBe(false);
  });
});

const ev = (kind: TimelineEvent["kind"], hash: string, at: number | null, chain: TimelineEvent["chain"] = "stellar"): TimelineEvent => ({ kind, chain, hash, at });

describe("orderTimeline", () => {
  test("lock and verification first, release last, whatever the input order", () => {
    const out = orderTimeline([ev("released", "r", 900, "bitcoin"), ev("borrowed", "b", 200), ev("verified", "v", 100), ev("btc_lock", "l", null, "bitcoin")]);
    expect(out.map((e) => e.kind)).toEqual(["btc_lock", "verified", "borrowed", "released"]);
  });

  test("repeated borrows and repays interleave by time", () => {
    const out = orderTimeline([ev("repaid", "r2", 400), ev("borrowed", "b1", 100), ev("repaid", "r1", 200), ev("borrowed", "b2", 300)]);
    expect(out.map((e) => e.hash)).toEqual(["b1", "r1", "b2", "r2"]);
  });

  test("an unknown time goes after known ones, then cycle order", () => {
    const out = orderTimeline([ev("repaid", "r", null), ev("received", "x", null), ev("borrowed", "b", 100)]);
    expect(out.map((e) => e.kind)).toEqual(["borrowed", "received", "repaid"]);
  });

  test("the same transaction twice shows once", () => {
    expect(orderTimeline([ev("verified", "v", 1), ev("verified", "v", 1)])).toHaveLength(1);
  });
});

describe("timelineRows", () => {
  test("adds the steps not reached yet, without transactions", () => {
    const rows = timelineRows([ev("btc_lock", "l", null, "bitcoin"), ev("verified", "v", 1)]);
    expect(rows.map((r) => [r.kind, r.event?.hash ?? null])).toEqual([
      ["btc_lock", "l"],
      ["verified", "v"],
      ["borrowed", null],
      ["received", null],
      ["repaid", null],
      ["released", null],
    ]);
  });

  test("a USDC borrow needs no separate receive step", () => {
    const rows = timelineRows([ev("btc_lock", "l", null, "bitcoin"), ev("verified", "v", 1), ev("borrowed", "b", 2)]);
    expect(rows.map((r) => r.kind)).toEqual(["btc_lock", "verified", "borrowed", "repaid", "released"]);
  });

  test("a full cycle has no placeholders", () => {
    const rows = timelineRows([
      ev("btc_lock", "l", null, "bitcoin"),
      ev("verified", "v", 1),
      ev("borrowed", "b", 2),
      ev("received", "x", 3),
      ev("repaid", "r", 4),
      ev("released", "z", null, "bitcoin"),
    ]);
    expect(rows.every((r) => r.event)).toBe(true);
  });
});

describe("clientTimeline", () => {
  const position: Position = {
    id: "t",
    owner: "G",
    txid: "t",
    collateralSats: "5000000",
    debtStroops: "0",
    index: 0,
    status: "active",
    createdAt: 10,
    stellarTxHash: "s",
  };

  test("builds the cycle from the loan record, settled activity and received legs", () => {
    const events = clientTimeline(
      { ...position, releaseTxid: "z" },
      [
        { hash: "b", chain: "stellar", label: "Borrowed 10.00 USDC", state: "done", at: 20 },
        { hash: "p", chain: "stellar", label: "Repay", state: "pending", at: 30 },
        { hash: "s", chain: "stellar", label: "Deposit registered on Stellar", state: "done", at: 10 },
      ],
      [{ kind: "received", chain: "stellar", hash: "x", at: 21, detail: "as XLM" }],
    );
    expect(orderTimeline(events).map((e) => [e.kind, e.hash])).toEqual([
      ["btc_lock", "t"],
      ["verified", "s"],
      ["borrowed", "b"],
      ["received", "x"],
      ["released", "z"],
    ]);
  });
});
