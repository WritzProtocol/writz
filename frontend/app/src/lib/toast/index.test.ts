import { describe, expect, test } from "bun:test";
import { SignatureRejectedError } from "@/lib/wallet/rejection";
import { onToast, settleToast, showToast, toastsHere, type Toast } from ".";

const link = { href: "/lend", label: "Open Lend" };

describe("settle toasts", () => {
  test("show only away from the route the transaction started on", () => {
    expect(toastsHere("/lend", "/lend")).toBe(false);
    expect(toastsHere("/lend", "/")).toBe(true);
  });

  test("a success carries its sentence, a timeout says not confirmed yet, a failure says it didn't go through", () => {
    expect(settleToast("/lend", link, { ok: true, text: "Supplied 100.00 USDC to the pool." })).toMatchObject({
      tone: "positive",
      label: "Done",
    });
    expect(settleToast("/lend", link, { ok: false, error: new Error("ConfirmationTimedOut"), what: "Your supply" })).toMatchObject({
      tone: "warning",
      label: "Not confirmed yet",
    });
    expect(settleToast("/lend", link, { ok: false, error: new Error("boom"), what: "Your supply" })?.text).toBe("Your supply didn't go through.");
  });

  test("a declined signature stays quiet", () => {
    expect(settleToast("/lend", link, { ok: false, error: new SignatureRejectedError("stellar"), what: "Your supply" })).toBeNull();
  });

  test("listeners get each toast once with its own id", () => {
    const seen: Toast[] = [];
    const off = onToast((t) => seen.push(t));
    showToast({ tone: "positive", label: "Done", text: "a", origin: "/lend", link });
    showToast({ tone: "positive", label: "Done", text: "b", origin: "/lend", link });
    off();
    showToast({ tone: "positive", label: "Done", text: "c", origin: "/lend", link });
    expect(seen.map((t) => t.text)).toEqual(["a", "b"]);
    expect(seen[0].id).not.toBe(seen[1].id);
  });
});
