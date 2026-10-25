import { describe, expect, test } from "bun:test";
import { parseRelayView } from "./relay";

const MINT = "0x" + "ab".repeat(32);

describe("parseRelayView", () => {
  test("every in-progress state is pending", () => {
    for (const kind of ["sent", "confirming", "confirmed"]) expect(parseRelayView({ kind, burnHash: "b" })).toEqual({ kind: "pending" });
  });

  test("arrived carries the mint transaction", () => {
    expect(parseRelayView({ kind: "arrived", mintHash: MINT, explorerUrl: "x" })).toEqual({ kind: "arrived", mintHash: MINT });
  });

  test("an arrival without a usable hash has no link", () => {
    expect(parseRelayView({ kind: "arrived", mintHash: null })).toEqual({ kind: "arrived", mintHash: null });
    expect(parseRelayView({ kind: "arrived", mintHash: "0x12" })).toEqual({ kind: "arrived", mintHash: null });
  });

  test("failed carries the reason", () => {
    expect(parseRelayView({ kind: "failed", reason: "no attestation" })).toEqual({ kind: "failed", reason: "no attestation" });
    expect(parseRelayView({ kind: "failed" })).toEqual({ kind: "failed", reason: "the relay stopped" });
  });

  test("anything else is not trusted", () => {
    for (const b of [null, "arrived", {}, { kind: "done" }, 42]) expect(parseRelayView(b)).toBeNull();
  });
});
