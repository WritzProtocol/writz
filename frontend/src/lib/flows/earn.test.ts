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
      // The ambiguous verbs on their own describe things that break by
      // themselves. Reading these as a rejection sends the user to the wrong fix.
      "The connection was closed",
      "WebSocket closed before the connection was established",
      "Operation cancelled",
      "The stream was closed unexpectedly",
    ]) {
      expect(isUserRejection(message)).toBe(false);
    }
  });

  it("accepts an ambiguous verb only next to the actor who would have done it", () => {
    expect(isUserRejection("User cancelled")).toBe(true);
    expect(isUserRejection("The modal was closed")).toBe(true);
    expect(isUserRejection("Popup dismissed")).toBe(true);
    expect(isUserRejection("cancelled")).toBe(false);
    expect(isUserRejection("dismissed")).toBe(false);
  });
});

describe("rejected signature reaches the user as guidance, not a raw error", () => {
  it("maps the canonical rejection to a plain-language message", () => {
    const shown = humanizeError(new Error(SIGNATURE_REJECTED), { flow: "earn-deposit" });
    expect(shown).not.toContain(SIGNATURE_REJECTED);
    expect(shown).toContain("nothing was submitted");
  });
});

describe("submission failures reach the user as guidance, not a raw error", () => {
  it("tells the user nothing moved when the network throttled the submission", () => {
    const shown = humanizeError(new Error("SubmissionThrottled"), { flow: "earn-deposit" });
    expect(shown).not.toContain("SubmissionThrottled");
    expect(shown).toContain("no funds moved");
  });

  it("does not claim failure when confirmation merely timed out", () => {
    const shown = humanizeError(new Error("ConfirmationTimedOut"), { flow: "earn-deposit" });
    expect(shown).not.toContain("ConfirmationTimedOut");
    expect(shown).not.toMatch(/failed/i);
    expect(shown).toContain("Do not send it again");
  });
});
