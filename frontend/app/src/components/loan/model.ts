"use client";

import { useState } from "react";
import type { FlowState } from "@/lib/flow/engine";
import type { ActivityItem, LoanTab, Read } from "@/lib/loan/model";
import type { Position } from "@/lib/position/types";
import type { DerivedStatus } from "@/lib/status/types";

export type LoanAccess = "disconnected" | "locked" | "finding" | "ready";

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
    /** The loan keys are derived for this session (needed to sign loan actions). */
    keysReady: boolean;
    unlocking: boolean;
    unlockError: unknown;
    unlock(): void;
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
  borrow(stroops: bigint): void;
  repay(stroops: bigint): void;
  release(): void;
  dismiss(): void;
  recheckPrice(): void;
  checkAgain(): void;
  importBackup(file: File): void;
  importState: { busy: boolean; error: unknown; done: boolean };
}

/**
 * A changed position (new commitment after a borrow or repay) starts its
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
