import type { ChainPosition } from "@/lib/contracts/writzLend";
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
    id: btcTxid(n),
    owner: STELLAR_ADDRESS,
    txid: btcTxid(n),
    collateralSats: COLLATERAL_SATS.toString(),
    debtStroops: "0",
    index: n - 1,
    status: "active",
    createdAt: now - 3 * 86_400_000,
    btcPubkey: BTC_PUBKEY,
    timelockHeight: TIMELOCK,
    vout: 0,
    stellarTxHash: STELLAR_TX,
    ...over,
  };
}

/** Loan n as `writz-lend.get_position` answers it. */
export function chainPosition(n: number, over: Partial<ChainPosition> = {}): ChainPosition {
  const debt = over.debtStroops ?? 0n;
  return {
    txid: btcTxid(n),
    status: "active",
    depositor: STELLAR_ADDRESS,
    collateralSats: COLLATERAL_SATS,
    debtStroops: debt,
    storedDebtStroops: debt,
    timelockHeight: TIMELOCK,
    userPubkey: BTC_PUBKEY,
    scriptPubKey: "0020" + "11".repeat(32),
    ledger: 1_000,
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

const unspent = { lockOutspend: { spent: false } } as const;

/** A loan whose local record and chain position agree, at `debt` with `status` on chain. */
function open(
  n: number,
  now: number,
  chain: Partial<ChainPosition>,
  expect: MockPosition["expect"],
  over: Partial<Position> = {},
): MockPosition {
  const position = chainPosition(n, chain);
  return {
    local: { position: note(n, now, { debtStroops: position.debtStroops.toString(), ...over }), pendingDeposit: null },
    chain: { position, ...unspent, releasePsbtReady: position.status === "closed" ? true : undefined },
    relayer: {},
    expect,
  };
}

const owing = (pct: number) => ({ debtStroops: debtForRatio(pct) });
const closed = { status: "closed" } as const;

/** Position fixtures, one per position status and the variants screens need. */
export const loans = {
  healthy: (n: number, now: number) => open(n, now, owing(200), "active"),
  belowLimit: (n: number, now: number) => open(n, now, owing(140), "active"),
  atRisk: (n: number, now: number) => open(n, now, owing(125), "at_risk"),
  liquidatable: (n: number, now: number) => open(n, now, owing(115), "liquidatable"),
  repaidLocked: (n: number, now: number) => open(n, now, closed, "repaid_locked"),
  neverBorrowed: (n: number, now: number) => open(n, now, {}, "repaid_locked"),
  missingBtcDetails: (n: number, now: number): MockPosition => {
    const m = open(n, now, closed, "repaid_locked", { vout: undefined });
    return { ...m, chain: { position: m.chain.position, releasePsbtReady: true } };
  },
  releasing: (n: number, now: number): MockPosition => {
    const m = open(n, now, closed, "releasing", { releaseTxid: releaseTxid(n), releaseAddress: BTC_ADDRESS });
    return { ...m, chain: { ...m.chain, lockOutspend: { spent: true, txid: releaseTxid(n), confirmed: false } } };
  },
  released: (n: number, now: number): MockPosition => {
    const m = open(n, now, closed, "released", { releaseTxid: releaseTxid(n), releaseAddress: BTC_ADDRESS });
    return { ...m, chain: { ...m.chain, lockOutspend: { spent: true, txid: releaseTxid(n), confirmed: true } } };
  },
  liquidated: (n: number, now: number): MockPosition => ({
    ...open(n, now, { status: "liquidated" }, "liquidated", { debtStroops: debtForRatio(115).toString() }),
    relayer: { liquidation: { found: true, txHash: LIQUIDATION_TX } },
  }),
  /** Liquidated longer ago than the RPC keeps events: the chain says so, the transaction is not found. */
  liquidatedNoTx: (n: number, now: number): MockPosition => ({
    ...open(n, now, { status: "liquidated" }, "liquidated", {
      debtStroops: debtForRatio(115).toString(),
      createdAt: now - 30 * 86_400_000,
    }),
    relayer: { liquidation: { found: false, complete: false } },
  }),
  /** Repaid from another device: this device last saw debt, the chain has it closed. */
  repaidElsewhere: (n: number, now: number): MockPosition =>
    open(n, now, closed, "repaid_locked", { debtStroops: debtForRatio(200).toString() }),
  checking: (n: number, now: number): MockPosition => ({
    ...open(n, now, owing(200), "checking"),
    chain: {},
    relayer: null,
  }),
  reclaimable: (n: number, now: number): MockPosition => ({
    ...open(n, now, { ...closed, timelockHeight: TIP - 10 }, "repaid_locked", { timelockHeight: TIP - 10 }),
    reclaimable: true,
  }),
  /** Repaid on chain; the relayer has not published the co-signed release yet. */
  syncing: (n: number, now: number): MockPosition => {
    const m = open(n, now, closed, "repaid_locked");
    return { ...m, chain: { ...m.chain, releasePsbtReady: false }, syncing: true };
  },
};

function deposit(n: number, now: number, over: Partial<PendingDeposit>, rest: Omit<MockPosition, "local">): MockPosition {
  return { local: { position: null, pendingDeposit: pendingDeposit(n, now, over) }, ...rest };
}

export const deposits = {
  sent: (n: number, now: number) =>
    deposit(n, now, { step: "sent", vout: undefined }, {
      chain: { depositTx: { seen: true, blockHeight: null }, position: null },
      relayer: { confirmations: 0 },
      expect: "btc_sent",
    }),
  unseen: (n: number, now: number) =>
    deposit(n, now, { step: "sent", vout: undefined, createdAt: now - 15 * 60_000 }, {
      chain: { depositTx: { seen: false }, position: null },
      relayer: { confirmations: 0 },
      expect: "btc_unseen",
    }),
  confirming: (n: number, now: number, m = 3, seen = 1) =>
    deposit(n, now, {}, {
      chain: { depositTx: { seen: true, blockHeight: TIP - seen + 1 }, position: null },
      relayer: { confirmations: seen, minConfirmations: m },
      expect: "confirming",
    }),
  relayerBehind: (n: number, now: number) =>
    deposit(n, now, {}, {
      chain: { depositTx: { seen: true, blockHeight: TIP }, position: null },
      relayer: { confirmations: 0, minConfirmations: MIN_CONFIRMATIONS },
      expect: "confirming",
    }),
  relayerUnreachable: (n: number, now: number) =>
    deposit(n, now, {}, {
      chain: { depositTx: { seen: true, blockHeight: null }, position: null },
      relayer: null,
      expect: "btc_sent",
    }),
  ready: (n: number, now: number) =>
    deposit(n, now, { step: "ready" }, {
      chain: { depositTx: { seen: true, blockHeight: TIP }, position: null },
      relayer: { confirmations: 1, minConfirmations: MIN_CONFIRMATIONS },
      expect: "ready_to_register",
    }),
  registering: (n: number, now: number, onChain: boolean) =>
    deposit(n, now, { step: "submitted", stellarTxHash: STELLAR_TX }, {
      chain: { position: onChain ? chainPosition(n) : null },
      relayer: {},
      expect: "registering",
    }),
  alreadyRegistered: (n: number, now: number) =>
    deposit(n, now, { step: "ready" }, {
      chain: { position: chainPosition(n) },
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
      return { phase: "preparing", step: "building" };
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
