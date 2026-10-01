import type { FlowState } from "@/lib/flow/engine";
import type { PendingTx } from "@/lib/flow/pendingTx";
import type { ChainReads, LocalInputs, PositionStatusKind, RelayerIndex } from "@/lib/status/types";

/** Unknown, empty and failed are different states. */
export type Reading<T> =
  | { state: "loading" }
  | { state: "failed"; lastGood?: T; at?: number }
  | { state: "ok"; value: T };

export interface MockStellarWallet {
  address: string;
  network: "TESTNET" | "PUBLIC";
  /** XLM balance in stroops; null when the account is not funded. */
  xlmStroops: bigint | null;
  /** Previous address when the account was switched in the extension (G3). */
  switchedFrom?: string;
  loans: "unsigned" | "finding" | "found";
}

export interface MockBitcoinWallet {
  address: string;
  pubkey: string;
  network: string;
  balanceSats: bigint;
}

export interface MockWallets {
  stellar: MockStellarWallet | null;
  bitcoin: MockBitcoinWallet | null;
  /** A connect prompt in flight or declined, before any wallet is connected. */
  connect?: { wallet: "stellar" | "bitcoin"; state: "awaiting" | "rejected" };
}

export interface MockGlobals {
  hydrating?: boolean;
  rpcUnreachable?: boolean;
  relayerUnreachable?: boolean;
  relayerCatchingUp?: boolean;
  mainnetGuard?: boolean;
  otherTabTx?: boolean;
}

/** One position as every layer sees it, and the status derive must produce from it. */
export interface MockPosition {
  local: LocalInputs;
  /** Per-position reads; the price and tip come from `MockWorld.chain`. */
  chain: Omit<ChainReads, "oraclePriceStroops" | "btcTipHeight">;
  /** Null: the relayer answers nothing for this position. */
  relayer: RelayerIndex | null;
  expect: PositionStatusKind;
  reclaimable?: boolean;
  syncing?: boolean;
}

export type TxLifecycleId =
  | "draft"
  | "preparing"
  | "awaiting_signature"
  | "signature_cancelled"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "timed_out"
  | "failed"
  | "needs_attention";

export type FlowKind = "deposit" | "borrow" | "repay" | "release" | "supply" | "withdraw" | "earn_deposit" | "earn_withdraw";

export interface MockFlow {
  kind: FlowKind;
  lifecycle: TxLifecycleId;
  state: FlowState;
}

export interface MockDeposit {
  amountSats?: bigint;
  /** The amount step is done; implied once a wallet is connected or connecting. */
  amountConfirmed?: boolean;
  amountError?: "below_min" | "above_balance" | "not_a_number";
  reviewAcknowledged?: boolean;
  timelockTooClose?: boolean;
  unavailable?: boolean;
  /** "I already sent BTC" on a new device. */
  newDeviceTxid?: { txid: string; paysLock: boolean };
  /** A second deposit was attempted while one is pending. */
  secondBlocked?: boolean;
  done?: boolean;
}

export interface MockLoanPage {
  /** Display number from the URL (`/loans/[n]`). */
  n: number;
  panel?: "borrow" | "repay" | "release";
  trustline: Reading<boolean>;
  walletUsdcStroops: Reading<bigint>;
  poolAvailableStroops: Reading<bigint>;
}

export interface MockEarn {
  apy: Reading<number>;
  trustline: Reading<boolean>;
  walletStroops: Reading<bigint>;
  vaultStroops: Reading<bigint>;
  earnedStroops: Reading<bigint>;
  strategyPaused?: boolean;
}

export interface MockLend {
  trustline: Reading<boolean>;
  walletUsdcStroops: Reading<bigint>;
  suppliedStroops: Reading<bigint>;
  pool: Reading<{ totalSupplied: bigint; totalBorrowed: bigint; available: bigint }>;
  inputError?: "over_wallet" | "over_supply";
}

export interface MockProtocol {
  pool: Reading<{ totalSupplied: bigint; totalBorrowed: bigint; available: bigint }>;
  vault: Reading<{ totalStroops: bigint; depositors: number; apy: number }>;
  /** Days since the first cohort; under 30 shows a partial bar. */
  cohortDays: number;
}

export interface MockReclaim {
  timelockHeight: number;
  /** `?loan=n` on the help page. */
  loan?: { n: number; p2wsh: string; txid: string };
}

export interface MockWorld {
  route: string;
  wallets: MockWallets;
  globals: MockGlobals;
  /** Global reads; undefined means the read failed. */
  chain: { oraclePriceStroops?: bigint; btcTipHeight?: number };
  positions: MockPosition[];
  activity: PendingTx[];
  flow?: MockFlow;
  deposit?: MockDeposit;
  loan?: MockLoanPage;
  earn?: MockEarn;
  lend?: MockLend;
  protocol?: MockProtocol;
  reclaim?: MockReclaim;
}

export type MockArea = "global" | "home" | "deposit" | "loan" | "earn" | "lend" | "protocol" | "help" | "tx" | "status";

export interface Scenario {
  id: string;
  area: MockArea;
  title: string;
  build(now: number): MockWorld;
}
