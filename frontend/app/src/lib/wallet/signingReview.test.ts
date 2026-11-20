import { describe, expect, test } from "bun:test";
import { SigningReviews, type ReviewRequest } from "./signingReview";

const ask = (mode: ReviewRequest["mode"]): ReviewRequest => ({
  mode,
  asked: "Supply 100.00 USDC to the lending pool",
  actual: ["Supply 100.00 USDC to the lending pool"],
  detail: null,
  limit: null,
  walletName: "Pollar",
});

describe("SigningReviews", () => {
  test("publishes one review at a time and resolves it with the answer", async () => {
    const r = new SigningReviews();
    let changes = 0;
    r.subscribe(() => changes++);
    const pending = r.request(ask("unknown"));
    const shown = r.get()!;
    expect(shown.mode).toBe("unknown");
    r.answer(shown.id, "sign");
    expect(await pending).toBe("sign");
    expect(r.get()).toBeNull();
    expect(changes).toBe(2);
  });

  test("a mismatch only ever resolves cancel", async () => {
    const r = new SigningReviews();
    const pending = r.request(ask("mismatch"));
    r.answer(r.get()!.id, "sign");
    expect(await pending).toBe("cancel");
  });

  test("a stale answer is ignored, a newer request cancels the older, and cancel() clears it", async () => {
    const r = new SigningReviews();
    const first = r.request(ask("large"));
    const firstId = r.get()!.id;
    const second = r.request(ask("large"));
    expect(await first).toBe("cancel");
    r.answer(firstId, "sign");
    expect(r.get()).not.toBeNull();
    r.cancel();
    expect(await second).toBe("cancel");
    expect(r.get()).toBeNull();
  });

  test("the latest mounted slot owns the review; none means the shell's fallback", () => {
    const r = new SigningReviews();
    expect(r.owner()).toBeNull();
    r.registerSlot("a");
    r.registerSlot("b");
    expect(r.owner()).toBe("b");
    r.unregisterSlot("b");
    expect(r.owner()).toBe("a");
    r.unregisterSlot("a");
    expect(r.owner()).toBeNull();
  });
});
