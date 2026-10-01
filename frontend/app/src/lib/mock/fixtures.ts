import type { FlowState } from "@/lib/flow/engine";
import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { Position } from "@/lib/position/types";
import type {
  FlowKind,
  MockBitcoinWallet,
  MockFlow,
  MockPosition,
  MockStellarWallet,
  MockWallets,
  MockWorld,
  Reading,
  TxLifecycleId,
} from "./types";

export const STROOP = 10_000_000n;
export const PRICE = 60_000n * STROOP;
export const TIP = 260_000;
export const TIMELOCK = 300_000;
export const MIN_CONFIRMATIONS = 1;

export const STELLAR_ADDRESS = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
export const OTHER_STELLAR_ADDRESS = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
export const BTC_ADDRESS = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
export const OTHER_BTC_ADDRESS = "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7";
// secp256k1 generator point: a valid compressed pubkey, so a P2WSH derives from it.
export const BTC_PUBKEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
export const LOCK_ADDRESS = "tb1qlockaddressfixture000000000000000000000000000000000000";
export const STELLAR_TX = "9a4f2c1e7b3d5a8f0c6e2b9d4a7f1c3e5b8d0a2f4c6e8b1d3a5f7c9e2b4d6a8f";
export const LIQUIDATION_TX = "5e7a9c1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c";

const COLLATERAL_SATS = 5_000_000n;

export const btcTxid = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
export const releaseTxid = (n: number) => `${btcTxid(n).slice(0, 62)}ee`;
export const commitmentHex = (n: number) => (2000 + n).toString(16).padStart(64, "0");

export const ok = <T>(value: T): Reading<T> => ({ state: "ok", value });
export const loading = <T>(): Reading<T> => ({ state: "loading" });
export const failed = <T>(lastGood?: T, at?: number): Reading<T> => ({ state: "failed", lastGood, at });

export const stellarWallet = (over: Partial<MockStellarWallet> = {}): MockStellarWallet => ({
  address: STELLAR_ADDRESS,
  network: "TESTNET",
  xlmStroops: 9_850n * STROOP,
  loans: "found",
  ...over,
});

export const bitcoinWallet = (over: Partial<MockBitcoinWallet> = {}): MockBitcoinWallet => ({
  address: BTC_ADDRESS,
  pubkey: BTC_PUBKEY,
  network: "signet",
  balanceSats: 12_000_000n,
  ...over,
});

export const NO_WALLETS: MockWallets = { stellar: null, bitcoin: null };
export const STELLAR_ONLY: MockWallets = { stellar: stellarWallet(), bitcoin: null };
export const BOTH_WALLETS: MockWallets = { stellar: stellarWallet(), bitcoin: bitcoinWallet() };

/** Debt that puts 0.05 BTC at $60k at the given collateral ratio. */
export const debtForRatio = (pct: number): bigint => (COLLATERAL_SATS * PRICE * 100n) / 100_000_000n / BigInt(pct);

/** Loan n (1-based) as this device stores it. */
export function note(n: number, now: number, over: Partial<Position> = {}): Position {
  return {
    id: String(2000 + n),
    owner: STELLAR_ADDRESS,
    txid: btcTxid(n),
    collateralSats: COLLATERAL_SATS.toString(),
    debtStroops: "0",
    index: n - 1,
    version: 2,
    commitment: String(2000 + n),
    nullifier: String(1000 + n),
    status: "active",
    createdAt: now - 3 * 86_400_000,
    btcPubkey: BTC_PUBKEY,
    timelockHeight: TIMELOCK,
    vout: 0,
    leafIndex: n - 1,
    ...over,
  };
}

export function pendingDeposit(n: number, now: number, over: Partial<PendingDeposit> = {}): PendingDeposit {
  return {
    btcTxid: btcTxid(n),
    sats: COLLATERAL_SATS.toString(),
    vout: 0,
    p2wsh: LOCK_ADDRESS,
    btcPubkey: BTC_PUBKEY,
    timelockHeight: TIMELOCK,
    stellarAddress: STELLAR_ADDRESS,
    positionIndex: n - 1,
    step: "confirming",
    createdAt: now - 4 * 60_000,
    updatedAt: now - 60_000,
    ...over,
  };
}

const unspentOpen = { nullifierSpent: false, lockOutspend: { spent: false } } as const;
const indexed = { liquidation: { found: false, complete: true } } as const;

function open(n: number, now: number, over: Partial<Position>, expect: MockPosition["expect"]): MockPosition {
  return { local: { position: note(n, now, over), pendingDeposit: null }, chain: unspentOpen, relayer: {}, expect };
}

/** Position fixtures, one per position status and the variants screens need. */
export const loans = {
  healthy: (n: number, now: number) => open(n, now, { debtStroops: debtForRatio(200).toString() }, "active"),
  belowLimit: (n: number, now: number) => open(n, now, { debtStroops: debtForRatio(140).toString() }, "active"),
  atRisk: (n: number, now: number) => open(n, now, { debtStroops: debtForRatio(125).toString() }, "at_risk"),
  liquidatable: (n: number, now: number) => open(n, now, { debtStroops: debtForRatio(115).toString() }, "liquidatable"),
  repaidLocked: (n: number, now: number) => open(n, now, {}, "repaid_locked"),
  neverBorrowed: (n: number, now: number) => open(n, now, { version: 0 }, "repaid_locked"),
  missingBtcDetails: (n: number, now: number): MockPosition => ({
    ...open(n, now, { btcPubkey: undefined, vout: undefined, timelockHeight: undefined }, "repaid_locked"),
    chain: { nullifierSpent: false },
  }),
  releasing: (n: number, now: number): MockPosition => ({
    ...open(n, now, { releaseTxid: releaseTxid(n), releaseAddress: BTC_ADDRESS }, "releasing"),
    chain: { nullifierSpent: false, lockOutspend: { spent: true, txid: releaseTxid(n), confirmed: false } },
  }),
  released: (n: number, now: number): MockPosition => ({
    ...open(n, now, { releaseTxid: releaseTxid(n), releaseAddress: BTC_ADDRESS }, "released"),
    chain: { nullifierSpent: false, lockOutspend: { spent: true, txid: releaseTxid(n), confirmed: true } },
  }),
  liquidated: (n: number, now: number): MockPosition => ({
    ...open(n, now, { debtStroops: debtForRatio(115).toString() }, "liquidated"),
    chain: { nullifierSpent: true, lockOutspend: { spent: false } },
    relayer: { liquidation: { found: true, txHash: LIQUIDATION_TX } },
  }),
  closedOnChain: (n: number, now: number): MockPosition => ({
    ...open(n, now, { debtStroops: debtForRatio(115).toString(), createdAt: now - 30 * 86_400_000 }, "closed_on_chain"),
    chain: { nullifierSpent: true, lockOutspend: { spent: false } },
    relayer: { liquidation: { found: false, complete: false } },
  }),
  changedElsewhere: (n: number, now: number): MockPosition => ({
    ...open(n, now, { debtStroops: debtForRatio(200).toString() }, "changed_elsewhere"),
    chain: { nullifierSpent: true, lockOutspend: { spent: false } },
    relayer: indexed,
  }),
  checking: (n: number, now: number): MockPosition => ({
    ...open(n, now, { debtStroops: debtForRatio(200).toString() }, "checking"),
    chain: {},
    relayer: null,
  }),
  reclaimable: (n: number, now: number): MockPosition => ({
    ...open(n, now, { timelockHeight: TIP - 10 }, "repaid_locked"),
    reclaimable: true,
  }),
  syncing: (n: number, now: number): MockPosition => ({
    ...loans.healthy(n, now),
    relayer: { catchingUp: true },
    syncing: true,
  }),
};

function deposit(
  n: number,
  now: number,
  over: Partial<PendingDeposit>,
  rest: Omit<MockPosition, "local"> & { proving?: boolean; insertFailed?: boolean },
): MockPosition {
  const { proving, insertFailed, ...fixture } = rest;
  return {
    local: { position: null, pendingDeposit: pendingDeposit(n, now, over), proving, insertFailed },
    ...fixture,
  };
}

export const deposits = {
  sent: (n: number, now: number) =>
    deposit(n, now, { step: "sent", vout: undefined }, {
      chain: { depositTx: { seen: true, blockHeight: null }, commitmentForTxid: null },
      relayer: { confirmations: 0 },
      expect: "btc_sent",
    }),
  unseen: (n: number, now: number) =>
    deposit(n, now, { step: "sent", vout: undefined, createdAt: now - 15 * 60_000 }, {
      chain: { depositTx: { seen: false }, commitmentForTxid: null },
      relayer: { confirmations: 0 },
      expect: "btc_unseen",
    }),
  confirming: (n: number, now: number, m = 3, seen = 1) =>
    deposit(n, now, {}, {
      chain: { depositTx: { seen: true, blockHeight: TIP - seen + 1 }, commitmentForTxid: null },
      relayer: { confirmations: seen, minConfirmations: m },
      expect: "confirming",
    }),
  relayerBehind: (n: number, now: number) =>
    deposit(n, now, {}, {
      chain: { depositTx: { seen: true, blockHeight: TIP }, commitmentForTxid: null },
      relayer: { confirmations: 0, minConfirmations: MIN_CONFIRMATIONS },
      expect: "confirming",
    }),
  relayerUnreachable: (n: number, now: number) =>
    deposit(n, now, {}, {
      chain: { depositTx: { seen: true, blockHeight: null }, commitmentForTxid: null },
      relayer: null,
      expect: "btc_sent",
    }),
  ready: (n: number, now: number) =>
    deposit(n, now, { step: "ready" }, {
      chain: { depositTx: { seen: true, blockHeight: TIP }, commitmentForTxid: null },
      relayer: { confirmations: 1, minConfirmations: MIN_CONFIRMATIONS },
      expect: "ready_to_register",
    }),
  proving: (n: number, now: number) =>
    deposit(n, now, { step: "ready" }, {
      chain: { depositTx: { seen: true, blockHeight: TIP }, commitmentForTxid: null },
      relayer: { confirmations: 1, minConfirmations: MIN_CONFIRMATIONS },
      expect: "proving",
      proving: true,
    }),
  registering: (n: number, now: number, step: 1 | 2) =>
    deposit(n, now, { step: step === 1 ? "submitted" : "registering", stellarTxHash: STELLAR_TX, commitment: String(2000 + n) }, {
      chain: step === 1 ? { commitmentForTxid: null } : { commitmentForTxid: commitmentHex(n), commitmentPending: true },
      relayer: {},
      expect: "registering",
    }),
  registerFailed: (n: number, now: number) =>
    deposit(n, now, { step: "registering", stellarTxHash: STELLAR_TX, commitment: String(2000 + n) }, {
      chain: { commitmentForTxid: commitmentHex(n), commitmentPending: true },
      relayer: {},
      expect: "register_failed",
      insertFailed: true,
    }),
  alreadyRegistered: (n: number, now: number) =>
    deposit(n, now, { step: "ready", commitment: String(2000 + n) }, {
      chain: { commitmentForTxid: commitmentHex(n), commitmentPending: false },
      relayer: {},
      expect: "registering",
    }),
};

const HASH = STELLAR_TX;

/** The engine state for each transaction lifecycle state; it folds confirming into submitted. */
export function lifecycleState(id: TxLifecycleId): FlowState {
  switch (id) {
    case "draft":
      return { phase: "idle" };
    case "preparing":
      return { phase: "proving" };
    case "awaiting_signature":
      return { phase: "awaiting_signature", wallet: "stellar" };
    case "signature_cancelled":
      return { phase: "signature_cancelled", wallet: "stellar" };
    case "submitted":
    case "confirming":
      return { phase: "submitted", hash: HASH };
    case "confirmed":
      return { phase: "settled", hash: HASH };
    case "timed_out":
      return { phase: "timed_out", hash: HASH };
    case "failed":
      return { phase: "failed", error: new Error("Error(Contract, #12)") };
    case "needs_attention":
      return { phase: "needs_attention", action: "finish_deposit", hash: HASH };
  }
}

export const flow = (kind: FlowKind, lifecycle: TxLifecycleId, state = lifecycleState(lifecycle)): MockFlow => ({
  kind,
  lifecycle,
  state,
});

export const POOL = { totalSupplied: 184_250n * STROOP, totalBorrowed: 61_430n * STROOP, available: 122_820n * STROOP };

export function baseWorld(over: Partial<MockWorld> = {}): MockWorld {
  return {
    route: "/",
    wallets: BOTH_WALLETS,
    globals: {},
    chain: { oraclePriceStroops: PRICE, btcTipHeight: TIP },
    positions: [],
    activity: [],
    ...over,
  };
}
