import { describe, expect, test } from "bun:test";
import { MINT_LOOKUP_POLL_MS, nextRelayPoll, parseRelayView, readRelayResponse, RELAY_POLL_MS } from "./relay";

const MINT = "0x" + "ab".repeat(32);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("parseRelayView", () => {
  test("every in-progress state is pending", () => {
    for (const kind of ["sent", "confirming", "confirmed"]) expect(parseRelayView({ kind, burnHash: "b" })).toEqual({ kind: "pending", retrying: null });
  });

  test("a transfer being retried stays pending, with the reason and the next attempt", () => {
    expect(parseRelayView({ kind: "confirmed", retrying: true, reason: "out of gas", nextRetryAt: "2026-10-25T16:00:00.000Z" })).toEqual({
      kind: "pending",
      retrying: { reason: "out of gas", nextRetryAt: "2026-10-25T16:00:00.000Z" },
    });
  });

  test("arrived carries the mint transaction, or null while the relay looks it up", () => {
    expect(parseRelayView({ kind: "arrived", mintHash: MINT, explorerUrl: "x" })).toEqual({ kind: "arrived", mintHash: MINT });
    expect(parseRelayView({ kind: "arrived", mintHash: null })).toEqual({ kind: "arrived", mintHash: null });
    expect(parseRelayView({ kind: "arrived", mintHash: "0x12" })).toEqual({ kind: "arrived", mintHash: null });
  });

  test("failed carries the reason and whether a new request starts it over", () => {
    expect(parseRelayView({ kind: "failed", reason: "Circle has no record", retryable: true })).toEqual({ kind: "failed", reason: "Circle has no record", retryable: true });
    expect(parseRelayView({ kind: "failed", reason: "refused" })).toEqual({ kind: "failed", reason: "refused", retryable: false });
  });

  test("anything else is not trusted", () => {
    for (const b of [null, "arrived", {}, { kind: "done" }, 42]) expect(parseRelayView(b)).toBeNull();
  });
});

describe("nextRelayPoll", () => {
  test("polls while on its way, and slowly while the mint link is looked up", () => {
    expect(nextRelayPoll(null)).toBe(RELAY_POLL_MS);
    expect(nextRelayPoll({ kind: "pending", retrying: null })).toBe(RELAY_POLL_MS);
    expect(nextRelayPoll({ kind: "pending", retrying: { reason: "r", nextRetryAt: null } })).toBe(RELAY_POLL_MS);
    expect(nextRelayPoll({ kind: "arrived", mintHash: null })).toBe(MINT_LOOKUP_POLL_MS);
  });

  test("stops once there is nothing left to wait for", () => {
    expect(nextRelayPoll({ kind: "arrived", mintHash: MINT })).toBeNull();
    expect(nextRelayPoll({ kind: "failed", reason: "r", retryable: true })).toBeNull();
    expect(nextRelayPoll({ kind: "disabled", reason: "r" })).toBeNull();
  });
});

describe("readRelayResponse", () => {
  test("202 while working is a normal answer", async () => {
    expect(await readRelayResponse(json(202, { kind: "sent" }))).toEqual({ kind: "pending", retrying: null });
  });

  test("a relay that is off is reported, not thrown", async () => {
    expect(await readRelayResponse(json(503, { error: "cctp_relay_disabled", message: "no key" }))).toEqual({ kind: "disabled", reason: "no key" });
  });

  test("other errors throw with the relay's message", async () => {
    await expect(readRelayResponse(json(429, { error: "rate_limited", message: "slow down" }))).rejects.toThrow("slow down");
    await expect(readRelayResponse(json(200, { kind: "nope" }))).rejects.toThrow("unexpected");
  });
});
