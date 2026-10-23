import { describe, expect, test } from "bun:test";
import type { ChainPosition } from "@/lib/contracts/writzLend";
import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
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
const PUBKEY = "02" + "11".repeat(32);

const position = (over: Partial<Position> = {}): Position => ({
  id: TXID,
  owner: "GOWNER",
  txid: TXID,
  collateralSats: "5000000",
  debtStroops: "0",
  index: 0,
  status: "active",
  createdAt: NOW - 86_400_000,
  btcPubkey: PUBKEY,
  timelockHeight: TIMELOCK,
  vout: 0,
  ...over,
});

const deposit = (over: Partial<PendingDeposit> = {}): PendingDeposit => ({
  btcTxid: TXID,
  sats: "5000000",
  vout: 0,
  p2wsh: "tb1qlock",
  btcPubkey: PUBKEY,
  timelockHeight: TIMELOCK,
  stellarAddress: "GOWNER",
  positionIndex: 0,
  step: "confirming",
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
  ...over,
});

/** 3000 USDC of debt on 0.05 BTC at $60k is exactly 100%; scale debt for a target ratio. */
const debtForRatio = (pct: number) => (3_000n * STROOP * 100n) / BigInt(pct);

/** `get_position` as `writz-lend` answers it. */
const onChain = (over: Partial<ChainPosition> = {}): ChainPosition => ({
  txid: TXID,
  status: "active",
  depositor: "GOWNER",
  collateralSats: 5_000_000n,
  debtStroops: 0n,
  storedDebtStroops: 0n,
  timelockHeight: TIMELOCK,
  userPubkey: PUBKEY,
  scriptPubKey: "0020" + "00".repeat(32),
  ledger: 1_000,
  ...over,
});

const openChain = (over: Partial<ChainPosition> = {}): ChainReads => ({
  position: onChain(over),
  oraclePriceStroops: PRICE,
  btcTipHeight: TIP,
  lockOutspend: { spent: false },
});

const borrowed = (pct: number): ChainReads => openChain({ debtStroops: debtForRatio(pct), storedDebtStroops: debtForRatio(pct) });

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

describe("derivePositionStatus, one test per status", () => {
  test("checking: the position read is missing", () => {
    expect(kindOf(inputs({ position: position() }))).toEqual({ kind: "checking", missing: ["position"] });
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

  test("ready_to_register: n >= m and no position for the txid", () => {
    const i = inputs(
      { pendingDeposit: deposit() },
      { depositTx: { seen: true, blockHeight: TIP - 5 }, btcTipHeight: TIP, position: null },
    );
    expect(kindOf(i)).toEqual({ kind: "ready_to_register" });
  });

  test("registering: submitted and not on chain yet, or on chain and not saved here yet", () => {
    const submitted = deposit({ step: "submitted", stellarTxHash: "f".repeat(64) });
    expect(kindOf(inputs({ pendingDeposit: submitted }, { position: null }))).toEqual({ kind: "registering" });
    expect(kindOf(inputs({ pendingDeposit: deposit() }, { position: onChain() }))).toEqual({ kind: "registering" });
  });

  test("active: healthy at 150% and above, below borrow limit from 130% to 149%", () => {
    expect(kindOf(inputs({ position: position() }, borrowed(150)))).toEqual({
      kind: "active",
      ratioBp: 15_000n,
      band: "healthy",
    });
    expect(kindOf(inputs({ position: position() }, borrowed(140)))).toMatchObject({
      kind: "active",
      band: "below_limit",
    });
  });

  test("at_risk: under 130% and at least 120%", () => {
    expect(kindOf(inputs({ position: position() }, borrowed(125)))).toMatchObject({ kind: "at_risk" });
    expect(kindOf(inputs({ position: position() }, borrowed(120)))).toMatchObject({ kind: "at_risk" });
  });

  test("liquidatable: under 120% and still active on chain", () => {
    expect(kindOf(inputs({ position: position() }, borrowed(115)))).toMatchObject({ kind: "liquidatable" });
  });

  test("repaid_locked: closed on chain and the lock output unspent", () => {
    expect(kindOf(inputs({ position: position() }, openChain({ status: "closed" })))).toEqual({
      kind: "repaid_locked",
      neverBorrowed: false,
      missingBtcDetails: false,
    });
  });

  test("releasing: release broadcast and not yet confirmed", () => {
    const p = position({ releaseTxid: RELEASE_TXID });
    const chain = { ...openChain({ status: "closed" }), lockOutspend: { spent: true, txid: RELEASE_TXID, confirmed: false } as const };
    expect(kindOf(inputs({ position: p }, chain))).toEqual({ kind: "releasing", btcTxid: RELEASE_TXID });
  });

  test("released: the lock output is spent by the release", () => {
    const chain = { ...openChain({ status: "closed" }), lockOutspend: { spent: true, txid: RELEASE_TXID, confirmed: true } as const };
    expect(kindOf(inputs({ position: position() }, chain))).toEqual({ kind: "released", btcTxid: RELEASE_TXID });
  });

  test("liquidated: the chain says so, with the transaction when the lookup finds it", () => {
    const chain = openChain({ status: "liquidated" });
    expect(kindOf(inputs({ position: position() }, chain, { liquidation: { found: true, txHash: "e".repeat(64) } }))).toEqual({
      kind: "liquidated",
      txHash: "e".repeat(64),
    });
    expect(kindOf(inputs({ position: position() }, chain, { liquidation: { found: false, complete: false } }))).toEqual({
      kind: "liquidated",
      txHash: null,
    });
  });

  test("reclaimable: overlay once the tip reaches the timelock and the output is unspent", () => {
    const d = derivePositionStatus(inputs({ position: position() }, { ...borrowed(200), btcTipHeight: TIMELOCK }));
    expect(d.status.kind).toBe("active");
    expect(d.reclaimable).toBe(true);
    expect(d.timelock).toEqual({ height: TIMELOCK, blocksLeft: 0 });
  });

  test("syncing: overlay while a repaid loan waits for the relayer's co-signed release", () => {
    const waiting = derivePositionStatus(inputs({ position: position() }, { ...openChain({ status: "closed" }), releasePsbtReady: false }));
    expect(waiting.status.kind).toBe("repaid_locked");
    expect(waiting.syncing).toBe(true);
    const ready = derivePositionStatus(inputs({ position: position() }, { ...openChain({ status: "closed" }), releasePsbtReady: true }));
    expect(ready.syncing).toBe(false);
  });
});

describe("derivePositionStatus edge cases", () => {
  test("missing price: an open loan with debt is checking, never a ratio", () => {
    const chain = { ...borrowed(200), oraclePriceStroops: undefined };
    expect(kindOf(inputs({ position: position() }, chain))).toEqual({ kind: "checking", missing: ["oracle_price"] });
  });

  test("missing price does not block a loan with debt 0", () => {
    const chain = { ...openChain(), oraclePriceStroops: undefined };
    expect(kindOf(inputs({ position: position() }, chain)).kind).toBe("repaid_locked");
  });

  test("active with debt 0 never borrowed: repaid_locked flagged as never borrowed", () => {
    expect(kindOf(inputs({ position: position() }, openChain()))).toMatchObject({
      kind: "repaid_locked",
      neverBorrowed: true,
    });
  });

  test("debt comes from the chain, not from this device's last read", () => {
    const stale = position({ debtStroops: debtForRatio(200).toString() });
    expect(kindOf(inputs({ position: stale }, borrowed(125)))).toMatchObject({ kind: "at_risk" });
    expect(kindOf(inputs({ position: stale }, openChain({ status: "closed" }))).kind).toBe("repaid_locked");
  });

  test("debt 0 with an unknown outspend is checking, not BTC still locked", () => {
    const chain = { ...openChain(), lockOutspend: undefined };
    expect(kindOf(inputs({ position: position() }, chain))).toEqual({ kind: "checking", missing: ["outspend"] });
  });

  test("debt 0 without the deposit output says so instead of reading an outspend it cannot address", () => {
    const p = position({ vout: undefined });
    expect(kindOf(inputs({ position: p }, { ...openChain({ status: "closed" }), lockOutspend: undefined }))).toEqual({
      kind: "repaid_locked",
      neverBorrowed: false,
      missingBtcDetails: true,
    });
  });

  test("a txid the chain has no position for stays checking: right after a deposit that is RPC lag", () => {
    expect(kindOf(inputs({ position: position() }, { ...openChain(), position: null }))).toEqual({
      kind: "checking",
      missing: ["position"],
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

  test("ready to register needs get_position before claiming one signature left", () => {
    const i = inputs({ pendingDeposit: deposit() }, {}, { confirmations: 6, minConfirmations: 6 });
    expect(kindOf(i)).toEqual({ kind: "checking", missing: ["position"] });
  });

  test("a submitted deposit with the position read missing is checking", () => {
    const i = inputs({ pendingDeposit: deposit({ step: "submitted", stellarTxHash: "f".repeat(64) }) });
    expect(kindOf(i)).toEqual({ kind: "checking", missing: ["position"] });
  });

  test("btc_sent within the first 10 minutes when Esplora has not seen it yet", () => {
    expect(kindOf(inputs({ pendingDeposit: deposit() }, { depositTx: { seen: false } }))).toEqual({ kind: "btc_sent" });
  });

  test("timelock reached on a repaid loan is reclaimable; spent output is not", () => {
    const reached = { ...openChain({ status: "closed" }), btcTipHeight: TIMELOCK + 10 };
    expect(derivePositionStatus(inputs({ position: position() }, reached)).reclaimable).toBe(true);
    const spent = { ...reached, lockOutspend: { spent: true, txid: RELEASE_TXID, confirmed: true } as const };
    const d = derivePositionStatus(inputs({ position: position() }, spent));
    expect(d.status.kind).toBe("released");
    expect(d.reclaimable).toBe(false);
  });

  test("timelock with the tip unknown has no blocks-left count and is not reclaimable", () => {
    const d = derivePositionStatus(inputs({ position: position() }, { ...openChain(), btcTipHeight: undefined }));
    expect(d.timelock).toEqual({ height: TIMELOCK, blocksLeft: null });
    expect(d.reclaimable).toBe(false);
  });

  test("liquidatable loans do not carry the reclaim overlay", () => {
    const d = derivePositionStatus(inputs({ position: position() }, { ...borrowed(110), btcTipHeight: TIMELOCK }));
    expect(d.status.kind).toBe("liquidatable");
    expect(d.reclaimable).toBe(false);
  });

  test("a relayer claiming a liquidation does not override an active position", () => {
    const i = inputs({ position: position() }, borrowed(200), { liquidation: { found: true, txHash: "e".repeat(64) } });
    expect(kindOf(i).kind).toBe("active");
  });

  test("a liquidated position whose collateral was later reclaimed stays liquidated", () => {
    const chain = { ...openChain({ status: "liquidated" }), lockOutspend: { spent: true, txid: RELEASE_TXID, confirmed: true } as const };
    expect(kindOf(inputs({ position: position() }, chain)).kind).toBe("liquidated");
  });

  test("local status is a hint: a record marked liquidated that the chain holds active is active", () => {
    expect(kindOf(inputs({ position: position({ status: "liquidated" }) }, borrowed(200))).kind).toBe("active");
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
