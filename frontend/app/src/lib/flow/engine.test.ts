import { describe, expect, test } from "bun:test";
import {
  IDLE,
  guardsUnload,
  hashOf,
  isInFlight,
  reduceFlow,
  type FlowEvent,
  type FlowState,
} from "./engine";

const run = (events: FlowEvent[], from: FlowState = IDLE) => events.reduce(reduceFlow, from);

describe("reduceFlow", () => {
  test("a borrow goes from preparing to settled and keeps its hash", () => {
    const s = run([
      { type: "start" },
      { type: "preparing", step: "merkle_path" },
      { type: "proving" },
      { type: "awaiting_signature", wallet: "stellar" },
      { type: "submitted", hash: "abc" },
      { type: "post_processing", step: "update_leaf" },
      { type: "settled" },
    ]);
    expect(s).toEqual({ phase: "settled", hash: "abc", syncPending: undefined });
  });

  test("a failure after submit still shows the hash", () => {
    const s = run([{ type: "start" }, { type: "submitted", hash: "abc" }, { type: "failed", error: "x" }]);
    expect(s.phase).toBe("failed");
    expect(hashOf(s)).toBe("abc");
  });

  test("a declined signature is neutral and only comes from awaiting_signature", () => {
    const declined = run([
      { type: "start" },
      { type: "awaiting_signature", wallet: "bitcoin" },
      { type: "signature_cancelled" },
    ]);
    expect(declined).toEqual({ phase: "signature_cancelled", wallet: "bitcoin", hash: undefined });

    const proving = run([{ type: "start" }, { type: "proving" }, { type: "signature_cancelled" }]);
    expect(proving.phase).toBe("proving");
  });

  test("confirmations keep counting and a relayer outage keeps the last count", () => {
    const s = run([
      { type: "start" },
      { type: "btc_confirmations", confirmations: 2, required: 6 },
      { type: "relayer_unreachable", required: 6 },
    ]);
    expect(s).toEqual({ phase: "waiting_btc", confirmations: 2, required: 6, relayerReachable: false });
  });

  test("a terminal state ignores late events from an abandoned run", () => {
    const settled = run([{ type: "start" }, { type: "settled", hash: "abc" }]);
    expect(reduceFlow(settled, { type: "btc_confirmations", confirmations: 1, required: 1 })).toBe(settled);
    expect(reduceFlow(settled, { type: "failed", error: "late" })).toBe(settled);

    const attention = run([
      { type: "start" },
      { type: "needs_attention", action: "finish_deposit", hash: "abc" },
    ]);
    expect(reduceFlow(attention, { type: "failed", error: "same error" })).toBe(attention);
  });

  test("a timed-out transaction can still settle or fail once reconciled", () => {
    const timedOut = run([{ type: "start" }, { type: "timed_out", hash: "abc" }]);
    expect(reduceFlow(timedOut, { type: "settled" })).toEqual({
      phase: "settled",
      hash: "abc",
      syncPending: undefined,
    });
    expect(reduceFlow(timedOut, { type: "failed", error: "x" }).phase).toBe("failed");
  });

  test("start and reset leave any state", () => {
    const failed = run([{ type: "start" }, { type: "failed", error: "x" }]);
    expect(reduceFlow(failed, { type: "start" })).toEqual({ phase: "preparing" });
    expect(reduceFlow(failed, { type: "reset" })).toBe(IDLE);
  });

  test("a resumed deposit can enter waiting or attention straight from idle or ready", () => {
    expect(reduceFlow(IDLE, { type: "btc_confirmations", confirmations: 0, required: 1 }).phase).toBe(
      "waiting_btc",
    );
    const ready = run([{ type: "ready" }]);
    expect(ready.phase).toBe("ready");
    expect(reduceFlow(ready, { type: "needs_attention", action: "finish_deposit" }).phase).toBe(
      "needs_attention",
    );
  });
});

describe("isInFlight and guardsUnload", () => {
  test("only phases where leaving loses a signature or submission guard unload", () => {
    const at = (s: FlowState) => [isInFlight(s), guardsUnload(s)];
    expect(at(IDLE)).toEqual([false, false]);
    expect(at({ phase: "waiting_btc", confirmations: 0, required: 1, relayerReachable: true })).toEqual([
      true,
      false,
    ]);
    expect(at({ phase: "proving" })).toEqual([true, false]);
    expect(at({ phase: "awaiting_signature", wallet: "stellar" })).toEqual([true, true]);
    expect(at({ phase: "submitted", hash: "a" })).toEqual([true, true]);
    expect(at({ phase: "post_processing", step: "insert" })).toEqual([true, true]);
    expect(at({ phase: "ready" })).toEqual([false, false]);
    expect(at({ phase: "needs_attention", action: "finish_deposit" })).toEqual([false, false]);
  });
});
