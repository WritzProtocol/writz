import { describe, expect, test } from "bun:test";
import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { PendingTx } from "@/lib/flow/pendingTx";
import type { Position } from "@/lib/position/types";
import { BTC_UNSEEN_AFTER_MS, collateralRatioBp, derivePositionStatus } from "./derive";
import type { ChainReads, LocalInputs, RelayerIndex, StatusInputs } from "./types";

const NOW = 1_800_000_000_000;
const STROOP = 10_000_000n;
const PRICE = 60_000n * STROOP;
const TIMELOCK = 300_000;
const TIP = 250_000;
const TXID = "ab".repeat(32);
const RELEASE_TXID = "cd".repeat(32);
const COMMITMENT_HEX = "0f".repeat(32);

const position = (over: Partial<Position> = {}): Position => ({
  id: "1",
  owner: "GOWNER",
  txid: TXID,
  collateralSats: "5000000",
  debtStroops: "0",
  index: 0,
  version: 1,
  commitment: "1",
  nullifier: "2",
  status: "active",
  createdAt: NOW - 86_400_000,
  btcPubkey: "02" + "11".repeat(32),
  timelockHeight: TIMELOCK,
  vout: 0,
  ...over,
});

const deposit = (over: Partial<PendingDeposit> = {}): PendingDeposit => ({
  btcTxid: TXID,
  sats: "5000000",
  vout: 0,
  p2wsh: "tb1qlock",
  btcPubkey: "02" + "11".repeat(32),
  timelockHeight: TIMELOCK,
  stellarAddress: "GOWNER",
  positionIndex: 0,
  step: "confirming",
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
  ...over,
});

/** 3000 USDC of debt on 0.05 BTC at $60k is exactly 100%; scale debt for a target ratio. */
const debtForRatio = (pct: number) => ((3_000n * STROOP * 100n) / BigInt(pct)).toString();

const openChain: ChainReads = {
  nullifierSpent: false,
  oraclePriceStroops: PRICE,
  btcTipHeight: TIP,
  lockOutspend: { spent: false },
};

function inputs(
  local: Partial<LocalInputs>,
  chain: ChainReads = {},
  relayer: RelayerIndex | null = null,
): StatusInputs {
  return {
    local: { position: null, pendingDeposit: null, ...local },
    chain,
    relayer,
    params: { minConfirmations: 6, now: NOW },
  };
}

const kindOf = (i: StatusInputs) => derivePositionStatus(i).status;

describe("derivePositionStatus, one test per ux-spec 7.1 row", () => {
  test("checking: a required read is missing", () => {
    expect(kindOf(inputs({ position: position({ debtStroops: debtForRatio(200) }) }))).toEqual({
      kind: "checking",
      missing: ["nullifier"],
    });
  });

  test("btc_sent: deposit tx in the mempool", () => {
    const i = inputs({ pendingDeposit: deposit() }, { depositTx: { seen: true, blockHeight: null } });
    expect(kindOf(i)).toEqual({ kind: "btc_sent" });
  });

  test("btc_unseen: Esplora has not seen the txid after 10 minutes", () => {
    const pd = deposit({ createdAt: NOW - BTC_UNSEEN_AFTER_MS });
    expect(kindOf(inputs({ pendingDeposit: pd }, { depositTx: { seen: false } }))).toEqual({ kind: "btc_unseen" });
  });

  test("confirming: n of m, from the relayer while Esplora has no answer", () => {
    const i = inputs({ pendingDeposit: deposit() }, {}, { confirmations: 2, minConfirmations: 3 });
    expect(kindOf(i)).toEqual({ kind: "confirming", n: 2, m: 3, relayerBehind: false });
  });

  test("ready_to_register: n >= m and no commitment for the txid", () => {
    const i = inputs(
      { pendingDeposit: deposit() },
      { depositTx: { seen: true, blockHeight: TIP - 5 }, btcTipHeight: TIP, commitmentForTxid: null },
    );
    expect(kindOf(i)).toEqual({ kind: "ready_to_register" });
  });

  test("proving: this tab is preparing the deposit", () => {
    expect(kindOf(inputs({ pendingDeposit: deposit({ step: "ready" }), proving: true }))).toEqual({ kind: "proving" });
  });

  test("registering: step 1 once submitted, step 2 while the insert is pending", () => {
    const submitted = deposit({ step: "submitted", stellarTxHash: "f".repeat(64) });
    expect(kindOf(inputs({ pendingDeposit: submitted }, { commitmentForTxid: null }))).toEqual({
      kind: "registering",
      step: 1,
    });
    expect(
      kindOf(inputs({ pendingDeposit: submitted }, { commitmentForTxid: COMMITMENT_HEX, commitmentPending: true })),
    ).toEqual({ kind: "registering", step: 2 });
  });

  test("register_failed: commitment pending and the insert failed", () => {
    const i = inputs(
      { pendingDeposit: deposit({ step: "registering" }), insertFailed: true },
      { commitmentForTxid: COMMITMENT_HEX, commitmentPending: true },
    );
    expect(kindOf(i)).toEqual({ kind: "register_failed" });
  });

  test("active: healthy at 150% and above, below borrow limit from 130% to 149%", () => {
    expect(kindOf(inputs({ position: position({ debtStroops: debtForRatio(150) }) }, openChain))).toEqual({
      kind: "active",
      ratioBp: 15_000n,
      band: "healthy",
    });
    expect(kindOf(inputs({ position: position({ debtStroops: debtForRatio(130) }) }, openChain))).toMatchObject({
      kind: "active",
      band: "below_limit",
    });
  });

  test("at_risk: under 130% and at least 120%", () => {
    expect(kindOf(inputs({ position: position({ debtStroops: debtForRatio(129) }) }, openChain))).toMatchObject({
      kind: "at_risk",
    });
    expect(kindOf(inputs({ position: position({ debtStroops: debtForRatio(120) }) }, openChain))).toMatchObject({
      kind: "at_risk",
    });
  });

  test("liquidatable: under 120%, nullifier unspent", () => {
    expect(kindOf(inputs({ position: position({ debtStroops: debtForRatio(119) }) }, openChain))).toMatchObject({
      kind: "liquidatable",
    });
  });

  test("repaid_locked: debt 0 and the lock output unspent", () => {
    expect(kindOf(inputs({ position: position() }, openChain))).toEqual({
      kind: "repaid_locked",
      neverBorrowed: false,
      missingBtcDetails: false,
    });
  });

  test("releasing: release broadcast and not yet confirmed", () => {
    const p = position({ releaseTxid: RELEASE_TXID });
    expect(kindOf(inputs({ position: p }, openChain))).toEqual({ kind: "releasing", btcTxid: RELEASE_TXID });
    const mempool = { ...openChain, lockOutspend: { spent: true, txid: RELEASE_TXID, confirmed: false } as const };
    expect(kindOf(inputs({ position: p }, mempool))).toEqual({ kind: "releasing", btcTxid: RELEASE_TXID });
  });

  test("released: the lock output is spent by the release", () => {
    const chain = { ...openChain, lockOutspend: { spent: true, txid: RELEASE_TXID, confirmed: true } as const };
    expect(kindOf(inputs({ position: position({ releaseTxid: RELEASE_TXID }) }, chain))).toEqual({
      kind: "released",
      btcTxid: RELEASE_TXID,
    });
  });

  test("liquidated: nullifier spent and a LiquidateEvent found", () => {
    const i = inputs(
      { position: position({ debtStroops: debtForRatio(110) }) },
      { ...openChain, nullifierSpent: true },
      { liquidation: { found: true, txHash: "e".repeat(64) } },
    );
    expect(kindOf(i)).toEqual({ kind: "liquidated", txHash: "e".repeat(64) });
  });

  test("changed_elsewhere: nullifier spent, no local tx, no liquidation in a complete lookup", () => {
    const i = inputs(
      { position: position({ debtStroops: debtForRatio(200) }) },
      { ...openChain, nullifierSpent: true },
      { liquidation: { found: false, complete: true } },
    );
    expect(kindOf(i)).toEqual({ kind: "changed_elsewhere" });
  });

  test("reclaimable: overlay once the tip reaches the timelock and the output is unspent", () => {
    const d = derivePositionStatus(
      inputs({ position: position({ debtStroops: debtForRatio(200) }) }, { ...openChain, btcTipHeight: TIMELOCK }),
    );
    expect(d.status.kind).toBe("active");
    expect(d.reclaimable).toBe(true);
    expect(d.timelock).toEqual({ height: TIMELOCK, blocksLeft: 0 });
  });

  test("syncing: overlay while the relayer catches up", () => {
    const d = derivePositionStatus(
      inputs({ position: position({ debtStroops: debtForRatio(200) }) }, openChain, { catchingUp: true }),
    );
    expect(d.status.kind).toBe("active");
    expect(d.syncing).toBe(true);
  });
});

describe("derivePositionStatus edge cases", () => {
  test("missing price: an open loan with debt is checking, never a ratio", () => {
    const chain = { ...openChain, oraclePriceStroops: undefined };
    expect(kindOf(inputs({ position: position({ debtStroops: debtForRatio(200) }) }, chain))).toEqual({
      kind: "checking",
      missing: ["oracle_price"],
    });
  });

  test("missing price does not block a loan with debt 0", () => {
    const chain = { ...openChain, oraclePriceStroops: undefined };
    expect(kindOf(inputs({ position: position() }, chain)).kind).toBe("repaid_locked");
  });

  test("debt 0 never borrowed is repaid_locked flagged as never borrowed", () => {
    expect(kindOf(inputs({ position: position({ version: 0 }) }, openChain))).toMatchObject({
      kind: "repaid_locked",
      neverBorrowed: true,
    });
  });

  test("debt 0 with an unknown outspend is checking, not BTC still locked", () => {
    const chain = { ...openChain, lockOutspend: undefined };
    expect(kindOf(inputs({ position: position() }, chain))).toEqual({ kind: "checking", missing: ["outspend"] });
  });

  test("debt 0 without Bitcoin details says so instead of reading an outspend it cannot address", () => {
    const p = position({ btcPubkey: undefined, vout: undefined });
    expect(kindOf(inputs({ position: p }, { ...openChain, lockOutspend: undefined }))).toEqual({
      kind: "repaid_locked",
      neverBorrowed: false,
      missingBtcDetails: true,
    });
  });

  test("absent relayer: confirmations fall back to the Esplora tip and the config m", () => {
    const i = inputs({ pendingDeposit: deposit() }, { depositTx: { seen: true, blockHeight: TIP - 1 }, btcTipHeight: TIP });
    expect(kindOf(i)).toEqual({ kind: "confirming", n: 2, m: 6, relayerBehind: false });
  });

  test("Esplora is the primary count when both answer", () => {
    const i = inputs(
      { pendingDeposit: deposit() },
      { depositTx: { seen: true, blockHeight: TIP - 2 }, btcTipHeight: TIP },
      { confirmations: 0, minConfirmations: 6 },
    );
    expect(kindOf(i)).toEqual({ kind: "confirming", n: 3, m: 6, relayerBehind: false });
  });

  test("relayer behind at m of m: Esplora has m, the relayer has not caught up", () => {
    const i = inputs(
      { pendingDeposit: deposit() },
      { depositTx: { seen: true, blockHeight: TIP - 9 }, btcTipHeight: TIP },
      { confirmations: 4, minConfirmations: 6 },
    );
    expect(kindOf(i)).toEqual({ kind: "confirming", n: 6, m: 6, relayerBehind: true });
  });

  test("a confirmed deposit block without the tip height is checking", () => {
    const i = inputs({ pendingDeposit: deposit() }, { depositTx: { seen: true, blockHeight: TIP } });
    expect(kindOf(i)).toEqual({ kind: "checking", missing: ["btc_tip"] });
  });

  test("ready to register needs get_commitment before claiming one signature left", () => {
    const i = inputs({ pendingDeposit: deposit() }, {}, { confirmations: 6, minConfirmations: 6 });
    expect(kindOf(i)).toEqual({ kind: "checking", missing: ["commitment"] });
  });

  test("a txid already deposited skips to registering even if the local step lags", () => {
    const i = inputs({ pendingDeposit: deposit() }, { commitmentForTxid: COMMITMENT_HEX, commitmentPending: true });
    expect(kindOf(i)).toEqual({ kind: "registering", step: 2 });
  });

  test("btc_sent within the first 10 minutes when Esplora has not seen it yet", () => {
    expect(kindOf(inputs({ pendingDeposit: deposit() }, { depositTx: { seen: false } }))).toEqual({ kind: "btc_sent" });
  });

  test("a position saved as registering resolves to active once the insert lands", () => {
    const p = position({ status: "registering", debtStroops: "0", version: 0 });
    expect(kindOf(inputs({ position: p }, { ...openChain, commitmentPending: true }))).toEqual({
      kind: "registering",
      step: 2,
    });
    expect(kindOf(inputs({ position: p }, { ...openChain, commitmentPending: false })).kind).toBe("repaid_locked");
  });

  test("timelock reached on a repaid loan is reclaimable; spent output is not", () => {
    const reached = { ...openChain, btcTipHeight: TIMELOCK + 10 };
    expect(derivePositionStatus(inputs({ position: position() }, reached)).reclaimable).toBe(true);
    const spent = { ...reached, lockOutspend: { spent: true, txid: RELEASE_TXID, confirmed: true } as const };
    const d = derivePositionStatus(inputs({ position: position() }, spent));
    expect(d.status.kind).toBe("released");
    expect(d.reclaimable).toBe(false);
  });

  test("timelock with the tip unknown has no blocks-left count and is not reclaimable", () => {
    const d = derivePositionStatus(inputs({ position: position() }, { ...openChain, btcTipHeight: undefined }));
    expect(d.timelock).toEqual({ height: TIMELOCK, blocksLeft: null });
    expect(d.reclaimable).toBe(false);
  });

  test("liquidatable loans do not carry the reclaim overlay", () => {
    const chain = { ...openChain, btcTipHeight: TIMELOCK };
    const d = derivePositionStatus(inputs({ position: position({ debtStroops: debtForRatio(110) }) }, chain));
    expect(d.status.kind).toBe("liquidatable");
    expect(d.reclaimable).toBe(false);
  });

  test("relayer claims liquidated but the chain nullifier is unspent: the chain wins", () => {
    const i = inputs(
      { position: position({ debtStroops: debtForRatio(200) }) },
      openChain,
      { liquidation: { found: true, txHash: "e".repeat(64) } },
    );
    expect(kindOf(i).kind).toBe("active");
  });

  test("nullifier spent without any liquidation lookup is checking", () => {
    const i = inputs({ position: position({ debtStroops: debtForRatio(200) }) }, { ...openChain, nullifierSpent: true });
    expect(kindOf(i)).toEqual({ kind: "checking", missing: ["liquidation"] });
  });

  test("nullifier spent beyond the RPC window never claims liquidated", () => {
    const i = inputs(
      { position: position({ debtStroops: debtForRatio(200) }) },
      { ...openChain, nullifierSpent: true },
      { liquidation: { found: false, complete: false } },
    );
    expect(kindOf(i)).toEqual({ kind: "closed_on_chain" });
  });

  test("stale relayer: a lookup marked complete while catching up is not trusted", () => {
    const i = inputs(
      { position: position({ debtStroops: debtForRatio(200) }) },
      { ...openChain, nullifierSpent: true },
      { liquidation: { found: false, complete: true }, catchingUp: true },
    );
    expect(kindOf(i)).toEqual({ kind: "closed_on_chain" });
  });

  test("nullifier spent by this device's own pending tx waits for reconcile", () => {
    const tx: PendingTx = {
      hash: "a".repeat(64),
      kind: "repay",
      createdAt: NOW,
      positionUpdate: { removeId: "1", save: position({ id: "2" }) },
    };
    const i = inputs(
      { position: position({ debtStroops: debtForRatio(200) }), pendingTxs: [tx] },
      { ...openChain, nullifierSpent: true },
      { liquidation: { found: false, complete: true } },
    );
    expect(kindOf(i)).toEqual({ kind: "checking", missing: ["local_tx"] });
  });

  test("an old note on another device sees the release from the outspend", () => {
    const i = inputs(
      { position: position({ debtStroops: debtForRatio(200) }) },
      { ...openChain, nullifierSpent: true, lockOutspend: { spent: true, txid: RELEASE_TXID, confirmed: true } },
      { liquidation: { found: false, complete: true } },
    );
    expect(kindOf(i)).toEqual({ kind: "released", btcTxid: RELEASE_TXID });
  });

  test("local status is a hint: a note marked liquidated with an unspent nullifier is active", () => {
    const p = position({ status: "liquidated", debtStroops: debtForRatio(200) });
    expect(kindOf(inputs({ position: p }, openChain)).kind).toBe("active");
  });

  test("nothing local to derive from is checking", () => {
    expect(kindOf(inputs({}))).toEqual({ kind: "checking", missing: ["position"] });
  });
});

describe("collateralRatioBp", () => {
  test("no debt has no ratio", () => {
    expect(collateralRatioBp(5_000_000n, 0n, PRICE)).toBeNull();
  });

  test("0.05 BTC at $60k against 1500 USDC is 200%", () => {
    expect(collateralRatioBp(5_000_000n, 1_500n * STROOP, PRICE)).toBe(20_000n);
  });
});
