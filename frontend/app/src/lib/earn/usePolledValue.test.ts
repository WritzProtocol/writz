import { describe, expect, it } from "bun:test";
import { applyRead, type PolledState } from "./usePolledValue";

const T0 = new Date("2026-09-08T10:00:00Z");
const T1 = new Date("2026-09-08T10:00:15Z");

describe("applyRead", () => {
  it("records a first successful read", () => {
    const next = applyRead<number>(null, "addr", { ok: true, value: 42 }, T0);
    expect(next).toEqual({ key: "addr", value: 42, error: null, updatedAt: T0 });
  });

  it("clears a previous error on the next success", () => {
    const errored: PolledState<number> = {
      key: "addr",
      value: 42,
      error: new Error("boom"),
      updatedAt: T0,
    };
    const next = applyRead(errored, "addr", { ok: true, value: 43 }, T1);
    expect(next.value).toBe(43);
    expect(next.error).toBeNull();
    expect(next.updatedAt).toBe(T1);
  });

  it("keeps the last good value when a read fails for the same key", () => {
    const good: PolledState<number> = {
      key: "addr",
      value: 42,
      error: null,
      updatedAt: T0,
    };
    const next = applyRead(good, "addr", { ok: false, error: new Error("down") }, T1);
    // The number the user is looking at survives the blip.
    expect(next.value).toBe(42);
    // And its timestamp does not advance, so the UI can say "last good read".
    expect(next.updatedAt).toBe(T0);
    expect(next.error).toBeInstanceOf(Error);
  });

  it("does not carry one key's value onto another when the new key fails", () => {
    const good: PolledState<number> = {
      key: "wallet-a",
      value: 42,
      error: null,
      updatedAt: T0,
    };
    const next = applyRead(good, "wallet-b", { ok: false, error: new Error("down") }, T1);
    // Showing wallet A's balance under wallet B would be worse than showing none.
    expect(next.key).toBe("wallet-b");
    expect(next.value).toBeNull();
    expect(next.updatedAt).toBeNull();
  });

  it("replaces the value outright when a different key succeeds", () => {
    const good: PolledState<number> = {
      key: "wallet-a",
      value: 42,
      error: null,
      updatedAt: T0,
    };
    const next = applyRead(good, "wallet-b", { ok: true, value: 7 }, T1);
    expect(next).toEqual({ key: "wallet-b", value: 7, error: null, updatedAt: T1 });
  });
});
