"use client";

import { useState } from "react";
import type { FlowState } from "@/lib/flow/engine";
import type { ActivityItem, LoanTab, Read } from "@/lib/loan/model";
import type { Position } from "@/lib/position/types";
import type { DerivedStatus } from "@/lib/status/types";
import type { ReceiveApis } from "@/lib/receive";
import type { ReceiveSeed } from "@/lib/mock/types";

export type LoanAccess = "disconnected" | "finding" | "ready";

export interface LoanBitcoin {
  address: string | null;
  pubkey: string | null;
  connecting: boolean;
  error: string | null;
  connect(): void;
  useOther(): void;
}

/** Everything the loan page renders and every action it can take, from the live wallets or a harness scenario. */
export interface LoanModel {
  n: number;
  access: LoanAccess;
  stellar: {
    walletName: string;
    connecting: boolean;
    connect(): void;
  };
  position: Position | null;
  /** A deposit for this loan number is still on its way. */
  depositInProgress: boolean;
  status: DerivedStatus;
  price: Read<bigint>;
  pool: Read<bigint>;
  trustline: Read<boolean>;
  walletUsdc: Read<bigint>;
  bitcoin: LoanBitcoin;
  releaseFeeSats: number | null;
  flow: FlowState;
  action: LoanTab | null;
  /** The amount the running or last borrow or repay was for. */
  lastAmount: bigint | null;
  trust: { busy: boolean; error: unknown; add(): void };
  otherTx: boolean;
  catchingUp: boolean;
  activity: ActivityItem[];
  requestedPanel: LoanTab | null;
  now: number;
  /** The Stellar address that signs; null while disconnected. */
  owner: string | null;
  /** How the loan can be received besides USDC on Stellar; a null API hides its option. */
  receive: ReceiveApis;
  /** Harness only: the state the receive step opens in. */
  receiveSeed?: ReceiveSeed;
  borrow(stroops: bigint): void;
  repay(stroops: bigint): void;
  release(): void;
  dismiss(): void;
  recheckPrice(): void;
  checkAgain(): void;
}

/**
 * A loan whose local record changed (after a borrow or repay) starts its
 * status read from scratch; keep showing the last answer for the same loan
 * meanwhile so the page doesn't flash back to "Checking...".
 */
export function useSteadyStatus(status: DerivedStatus, loanKey: string | null): DerivedStatus {
  const [last, setLast] = useState<{ key: string | null; status: DerivedStatus } | null>(null);
  const fresh = !(status.status.kind === "checking" && status.status.missing.length === 0);
  if (fresh && (last?.key !== loanKey || last.status !== status)) setLast({ key: loanKey, status });
  if (fresh) return status;
  return last && last.key === loanKey ? last.status : status;
}
