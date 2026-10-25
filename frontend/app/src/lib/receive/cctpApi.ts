/**
 * Receive on Base Sepolia: the borrowed USDC burned on Stellar with Circle
 * CCTP V2 and minted on Base Sepolia by a relay, so the borrower needs no
 * wallet there. The UI codes against `CctpApi`.
 */

export type CctpStatus =
  | { kind: "sent" }
  /** Circle is confirming the burn. */
  | { kind: "confirming" }
  /** Circle confirmed; the relay is minting on Base Sepolia. */
  | { kind: "confirmed" }
  | { kind: "arrived"; mintHash: string }
  | { kind: "failed"; reason: string };

export interface CctpApi {
  /** Builds, has `owner` sign and submits the burn on Stellar; resolves with its transaction hash once it settles. */
  send(usdcStroops: bigint, to: `0x${string}`, owner: string): Promise<{ burnHash: string }>;
  status(burnHash: string): Promise<CctpStatus>;
}

export type CctpStepState = "done" | "now" | "next" | "failed";

export interface CctpStep {
  label: string;
  state: CctpStepState;
  /** The transaction this step links to, once there is one. */
  tx?: { chain: "stellar" | "base-sepolia"; hash: string };
}

/** The three plain-language steps of a transfer, from its status. */
export function cctpSteps(burnHash: string, status: CctpStatus | null): CctpStep[] {
  const sent: CctpStep = { label: "Sent from Stellar", state: "done", tx: { chain: "stellar", hash: burnHash } };
  const kind = status?.kind ?? "sent";
  if (kind === "arrived" && status?.kind === "arrived") {
    return [
      sent,
      { label: "Circle confirms", state: "done" },
      { label: "Arrived", state: "done", tx: { chain: "base-sepolia", hash: status.mintHash } },
    ];
  }
  if (kind === "confirmed") return [sent, { label: "Circle confirms", state: "done" }, { label: "Arrived", state: "now" }];
  if (kind === "failed") return [sent, { label: "Circle confirms", state: "failed" }, { label: "Arrived", state: "next" }];
  return [sent, { label: "Circle confirms", state: "now" }, { label: "Arrived", state: "next" }];
}

/** Poll until it arrives or fails. */
export const cctpSettled = (s: CctpStatus | null): boolean => s?.kind === "arrived" || s?.kind === "failed";
