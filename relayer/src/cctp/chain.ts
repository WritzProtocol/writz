/**
 * What the relay needs from Base Sepolia, as an interface so the relay's
 * logic is tested without a node. `evm-chain.ts` implements it with viem.
 */

export type SimulateOutcome =
  | { ok: true }
  /** `revert` is the contract's reason when it reverted; `transient` when the RPC itself failed. */
  | { ok: false; transient: boolean; revert?: string; detail: string };

export type ReceiptOutcome = "success" | "reverted" | "pending";

export interface MintLog {
  txHash: string;
  /** The account that called `receiveMessage`. */
  caller: string;
}

export class SendError extends Error {
  constructor(
    public readonly kind: "insufficient_funds" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "SendError";
  }
}

export interface RelayChain {
  /** The relay key's Base Sepolia address. */
  readonly address: string;
  balanceWei(): Promise<bigint>;
  /** True once MessageTransmitterV2 has received a message with this nonce, from anyone. */
  isNonceUsed(nonce: string): Promise<boolean>;
  /** The `MessageReceived` log for this nonce, searched back from the chain head over a bounded range. */
  findMint(nonce: string): Promise<MintLog | undefined>;
  simulateReceive(message: string, attestation: string): Promise<SimulateOutcome>;
  /** Broadcasts `receiveMessage` from the relay key and returns the transaction hash. Throws `SendError`. */
  sendReceive(message: string, attestation: string): Promise<string>;
  /** Waits a bounded time for the receipt; `pending` when it is not mined by then. */
  waitForReceipt(txHash: string): Promise<ReceiptOutcome>;
}
