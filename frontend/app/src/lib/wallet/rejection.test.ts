import { describe, expect, it } from "bun:test";
import {
  asRejection,
  errorMessage,
  isSignatureRejected,
  isUserRejection,
  SignatureRejectedError,
  SIGNATURE_REJECTED,
  walletLabel,
  withRejection,
} from "./rejection";
import { xverseRequest, XverseError } from "@/lib/bitcoin/xverse";
import { reduceFlow } from "@/lib/flow/engine";

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

describe("errorMessage", () => {
  it("reads the message off the plain objects Stellar Wallets Kit rejects with", () => {
    expect(errorMessage({ code: -1, message: "The user rejected this request." })).toBe(
      "The user rejected this request.",
    );
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});

describe("asRejection", () => {
  it("normalizes a kit rejection object into SignatureRejectedError", () => {
    const e = asRejection({ code: -4, message: "User declined access" }, "stellar", "Freighter");
    expect(e).toBeInstanceOf(SignatureRejectedError);
    expect(e?.walletName).toBe("Freighter");
    expect(isSignatureRejected(e)).toBe(true);
  });

  it("keeps an existing rejection and its wallet", () => {
    const original = new SignatureRejectedError("bitcoin", "Xverse");
    expect(asRejection(original, "stellar")).toBe(original);
  });

  it("returns null for real failures", () => {
    expect(asRejection(new Error("Request failed with status code 500"), "stellar")).toBeNull();
  });
});

describe("withRejection", () => {
  it("passes results through and turns a decline into SignatureRejectedError", async () => {
    expect(await withRejection("stellar", "Freighter", async () => 7)).toBe(7);
    const thrown = await withRejection("stellar", "Freighter", async () => {
      throw { code: -4, message: "User rejected the request" };
    }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(SignatureRejectedError);
    expect(walletLabel(thrown)).toBe("Freighter");
  });

  it("rethrows other failures untouched", async () => {
    const boom = new Error("fetch failed");
    expect(await withRejection("stellar", undefined, async () => Promise.reject(boom)).catch((e) => e)).toBe(boom);
  });
});

describe("walletLabel", () => {
  it("names Xverse for a Bitcoin decline and falls back to a generic label", () => {
    expect(walletLabel(new SignatureRejectedError("bitcoin"))).toBe("Xverse");
    expect(walletLabel(new SignatureRejectedError("stellar"))).toBe("your wallet");
    expect(walletLabel(new Error(SIGNATURE_REJECTED))).toBe("your wallet");
  });
});

describe("xverseRequest", () => {
  it("maps USER_REJECTION to SignatureRejectedError", async () => {
    const e = await xverseRequest(async () => ({
      status: "error" as const,
      error: { code: -32000, message: "User rejected the request" },
    })).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(SignatureRejectedError);
    expect(walletLabel(e)).toBe("Xverse");
  });

  it("maps any other Xverse failure to XverseError", async () => {
    const e = await xverseRequest(async () => ({
      status: "error" as const,
      error: { code: -32603, message: "Internal error" },
    })).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(XverseError);
    expect(isSignatureRejected(e)).toBe(false);
  });

  it("returns the result on success", async () => {
    expect(await xverseRequest(async () => ({ status: "success" as const, result: { txid: "ab" } }))).toEqual({
      txid: "ab",
    });
  });
});

describe("a declined signature in any flow", () => {
  it("lands as signature_cancelled, not failed, naming the wallet", () => {
    const waiting = reduceFlow({ phase: "preparing" }, { type: "awaiting_signature", wallet: "bitcoin" });
    const after = reduceFlow(waiting, { type: "failed", error: new SignatureRejectedError("bitcoin", "Xverse") });
    expect(after).toEqual({ phase: "signature_cancelled", wallet: "bitcoin", walletName: "Xverse", hash: undefined });
  });

  it("is still a failure when it happens outside a signature prompt", () => {
    const after = reduceFlow({ phase: "proving" }, { type: "failed", error: new SignatureRejectedError("stellar") });
    expect(after.phase).toBe("failed");
  });
});
