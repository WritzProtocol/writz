import { describe, expect, it } from "bun:test";
import { isUserRejection } from "./earn";
import { humanizeError } from "@/lib/errors";
import { SIGNATURE_REJECTED } from "./earn";

describe("isUserRejection", () => {
  it("recognizes how each supported wallet words a rejection", () => {
    for (const message of [
      "User declined access", // Freighter
      "The user rejected this request.", // Freighter
      "User rejected the request", // xBull, Lobstr
      "Action canceled by the user", // Albedo
      "User rejected", // Rabet
      "User rejected request", // Privy
      "User closed the modal", // Privy
      "Request cancelled by user",
      "Signature denied",
    ]) {
      expect(isUserRejection(message)).toBe(true);
    }
  });

  it("does not mistake a real wallet or network failure for a rejection", () => {
    for (const message of [
      "No Privy wallet connected",
      "Request failed with status code 500",
      "Relayer unreachable",
      "Transaction failed on-chain: InsufficientAmount",
      "fetch failed",
      "Missing contract address for commitment-tree",
    ]) {
      expect(isUserRejection(message)).toBe(false);
    }
  });
});

describe("rejected signature reaches the user as guidance, not a raw error", () => {
  it("maps the canonical rejection to a plain-language message", () => {
    const shown = humanizeError(new Error(SIGNATURE_REJECTED), { flow: "earn-deposit" });
    expect(shown).not.toContain(SIGNATURE_REJECTED);
    expect(shown).toContain("nothing was submitted");
  });
});
