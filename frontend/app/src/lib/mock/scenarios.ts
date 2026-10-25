import {
  BOTH_WALLETS,
  NO_WALLETS,
  OTHER_BTC_ADDRESS,
  OTHER_STELLAR_ADDRESS,
  POOL,
  STELLAR_ONLY,
  STELLAR_TX,
  STROOP,
  TIMELOCK,
  TIP,
  LOCK_ADDRESS,
  baseWorld,
  bitcoinWallet,
  btcTxid,
  deposits,
  failed,
  flow,
  loading,
  loans,
  ok,
  stellarWallet,
} from "./fixtures";
import type {
  MockArea,
  MockEarn,
  MockLend,
  MockLoanPage,
  MockPosition,
  MockProtocol,
  MockReceive,
  MockWorld,
  ReceiveSeed,
  Scenario,
  TxLifecycleId,
} from "./types";
import type { CctpStatus } from "@/lib/receive/cctpApi";

/**
 * Mock harness scenarios, one per screen state ID. Select one
 * with `?scenario=<id>` while NEXT_PUBLIC_UI_MOCK=1 (see `gate.ts`).
 *
 *   G1-G8     global states            /  (any client route)
 *   H1-H23    home                     /
 *   B1-B37    deposit journey          /borrow/new
 *   L1-L35    loan detail              /loans/1
 *   E1-E11    earn                     /earn
 *   N1-N19    lend                     /lend
 *   P1-P5     protocol                 /protocol
 *   R1-R4     reclaim help             /help/reclaim
 *   tx.<id>   transaction lifecycle    draft, preparing, awaiting_signature, signature_cancelled,
 *                                      submitted, confirming, confirmed, timed_out, failed, needs_attention
 *   status.<kind>  position status rows, e.g. status.at_risk, status.reclaimable
 */

const AREAS: Record<string, MockArea> = {
  G: "global",
  H: "home",
  B: "deposit",
  L: "loan",
  E: "earn",
  N: "lend",
  P: "protocol",
  R: "help",
};

const areaOf = (id: string): MockArea =>
  id.startsWith("tx.") ? "tx" : id.startsWith("status.") ? "status" : AREAS[id[0]];

const define = (id: string, title: string, build: (now: number) => MockWorld): Scenario => ({
  id,
  area: areaOf(id),
  title,
  build,
});

const home = (over: Partial<MockWorld> = {}) => baseWorld({ route: "/", ...over });

const usdc = (n: number) => BigInt(Math.round(n * 100)) * (STROOP / 100n);

const borrowNew = (over: Partial<MockWorld> = {}) =>
  baseWorld({ route: "/borrow/new", deposit: { amountSats: 5_000_000n, reviewAcknowledged: false }, ...over });

const loanPage = (over: Partial<MockLoanPage> = {}): MockLoanPage => ({
  n: 1,
  trustline: ok(true),
  walletUsdcStroops: ok(usdc(1620)),
  poolAvailableStroops: ok(POOL.available),
  ...over,
});

const BASE_TO = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const borrowSettled = flow("borrow", "confirmed", { phase: "settled", hash: STELLAR_TX });
const receiveSeed = (
  option: "xlm" | "base",
  step2: NonNullable<ReceiveSeed["step2"]>,
  cctp?: CctpStatus,
): MockReceive => ({
  api: { cctp },
  seed: { option, to: option === "base" ? BASE_TO : undefined, amountStroops: usdc(500), step2 },
});

const loanWorld = (position: MockPosition, over: Partial<MockWorld> = {}, page: Partial<MockLoanPage> = {}) =>
  baseWorld({ route: "/loans/1", positions: [position], loan: loanPage(page), ...over });

const earnState = (over: Partial<MockEarn> = {}): MockEarn => ({
  apy: ok(0.0731),
  trustline: ok(true),
  walletStroops: ok(usdc(1240.5)),
  vaultStroops: ok(usdc(1003.412)),
  earnedStroops: ok(usdc(3.412)),
  ...over,
});
const earn = (over: Partial<MockEarn> = {}, world: Partial<MockWorld> = {}) =>
  baseWorld({ route: "/earn", wallets: STELLAR_ONLY, earn: earnState(over), ...world });

const lendState = (over: Partial<MockLend> = {}): MockLend => ({
  trustline: ok(true),
  walletUsdcStroops: ok(usdc(1240)),
  suppliedStroops: ok(usdc(2500)),
  pool: ok(POOL),
  ...over,
});
const lend = (over: Partial<MockLend> = {}, world: Partial<MockWorld> = {}) =>
  baseWorld({ route: "/lend", wallets: STELLAR_ONLY, lend: lendState(over), ...world });

const protocolState = (over: Partial<MockProtocol> = {}): MockProtocol => ({
  pool: ok(POOL),
  vault: ok({ totalStroops: usdc(48_210), depositors: 37, apy: 0.0731 }),
  cohortDays: 45,
  ...over,
});
const protocol = (over: Partial<MockProtocol> = {}) =>
  baseWorld({ route: "/protocol", wallets: NO_WALLETS, protocol: protocolState(over) });

const help = (over: Partial<MockWorld> = {}) =>
  baseWorld({ route: "/help/reclaim", wallets: NO_WALLETS, reclaim: { timelockHeight: TIMELOCK }, ...over });

const unfunded = { stellar: stellarWallet({ xlmStroops: null }), bitcoin: null };
const wrongNetwork = { stellar: stellarWallet({ network: "PUBLIC" as const }), bitcoin: null };

const GLOBAL: Scenario[] = [
  define("G1", "Hydrating", () => home({ globals: { hydrating: true } })),
  define("G2", "Stellar wallet on the wrong network", () => home({ wallets: { ...BOTH_WALLETS, stellar: wrongNetwork.stellar } })),
  define("G3", "Wallet account switched in the extension", () =>
    home({ wallets: { ...BOTH_WALLETS, stellar: stellarWallet({ switchedFrom: OTHER_STELLAR_ADDRESS, loans: "finding" }) } }),
  ),
  define("G4", "Stellar RPC unreachable", (now) =>
    home({ globals: { rpcUnreachable: true }, positions: [{ ...loans.healthy(1, now), expect: "checking" }] }),
  ),
  define("G5", "Relayer catching up", (now) =>
    home({ globals: { relayerCatchingUp: true }, positions: [loans.syncing(1, now)] }),
  ),
  define("G6", "Mainnet guard tripped", () => home({ globals: { mainnetGuard: true } })),
  define("G7", "Another tab has a transaction in flight", (now) =>
    home({ globals: { otherTabTx: true }, positions: [loans.healthy(1, now)] }),
  ),
  define("G8", "Transactions settle while on another route", (now) =>
    home({ globals: { settledElsewhere: true }, positions: [loans.healthy(1, now)] }),
  ),
];

const HOME: Scenario[] = [
  define("H1", "New, nothing connected", () => home({ wallets: NO_WALLETS })),
  define("H2", "Stellar connected, Bitcoin not, no loans", () => home({ wallets: STELLAR_ONLY })),
  define("H3", "Both connected, no loans", () => home()),
  define("H4", "Connected, finding loans failed", () =>
    home({ wallets: { ...BOTH_WALLETS, stellar: stellarWallet({ loans: "failed" }) } }),
  ),
  define("H5", "Finding loans", () => home({ wallets: { ...BOTH_WALLETS, stellar: stellarWallet({ loans: "finding" }) } })),
  define("H6", "Deposit in progress, confirming", (now) => home({ positions: [deposits.confirming(1, now)] })),
  define("H7", "Deposit ready to register", (now) => home({ positions: [deposits.ready(1, now)] })),
  define("H8", "Deposit registered, saving on this device", (now) => home({ positions: [deposits.registering(1, now, true)] })),
  define("H9", "Deposit BTC not seen", (now) => home({ positions: [deposits.unseen(1, now)] })),
  define("H10", "One healthy loan", (now) => home({ positions: [loans.healthy(1, now)] })),
  define("H11", "Loan close to liquidation", (now) => home({ positions: [loans.atRisk(1, now)] })),
  define("H12", "Loan can be liquidated", (now) => home({ positions: [loans.liquidatable(1, now)] })),
  define("H13", "Repaid, BTC locked", (now) => home({ positions: [loans.repaidLocked(1, now)] })),
  define("H14", "Releasing", (now) => home({ positions: [loans.releasing(1, now)] })),
  define("H15", "Liquidated (most recent)", (now) =>
    home({ positions: [loans.healthy(1, now), loans.liquidated(2, now)] }),
  ),
  define("H16", "Reclaim available", (now) => home({ positions: [loans.reclaimable(1, now)] })),
  define("H17", "Lender only", () =>
    home({ wallets: STELLAR_ONLY, earn: earnState(), lend: lendState() }),
  ),
  define("H18", "Loans and vault or pool supply", (now) =>
    home({ positions: [loans.healthy(1, now)], earn: earnState(), lend: lendState() }),
  ),
  define("H19", "Loan status checking", (now) => home({ positions: [loans.checking(1, now)] })),
  define("H20", "Read failure", (now) =>
    home({ globals: { rpcUnreachable: true }, positions: [{ ...loans.healthy(1, now), expect: "checking" }] }),
  ),
  define("H21", "Repaid from another device", (now) => home({ positions: [loans.repaidElsewhere(1, now)] })),
  define("H22", "Two open loans, one below borrow limit", (now) =>
    home({ positions: [loans.healthy(1, now), loans.belowLimit(2, now)] }),
  ),
  define("H23", "Open loan with no debt", (now) => home({ positions: [loans.neverBorrowed(1, now)] })),
];

const DEPOSIT: Scenario[] = [
  define("B1", "Fresh, disconnected", () => borrowNew({ wallets: NO_WALLETS })),
  define("B2", "Amount invalid", () => borrowNew({ wallets: NO_WALLETS, deposit: { amountSats: 1_000n, amountError: "below_min" } })),
  define("B3", "Stellar not connected", () =>
    borrowNew({ wallets: NO_WALLETS, deposit: { amountSats: 5_000_000n, amountConfirmed: true } }),
  ),
  define("B4", "Stellar awaiting connect", () =>
    borrowNew({ wallets: { ...NO_WALLETS, connect: { wallet: "stellar", state: "awaiting" } } }),
  ),
  define("B5", "Stellar connect rejected", () =>
    borrowNew({ wallets: { ...NO_WALLETS, connect: { wallet: "stellar", state: "rejected" } } }),
  ),
  define("B6", "Stellar finding loans failed", () =>
    borrowNew({ wallets: { stellar: stellarWallet({ loans: "failed" }), bitcoin: null } }),
  ),
  define("B7", "Stellar finding loans", () => borrowNew({ wallets: { stellar: stellarWallet({ loans: "finding" }), bitcoin: null } })),
  define("B8", "Existing pending deposit found", (now) => borrowNew({ positions: [deposits.confirming(1, now)] })),
  define("B9", "Stellar unfunded", () => borrowNew({ wallets: unfunded })),
  define("B10", "Stellar low XLM", () => borrowNew({ wallets: { stellar: stellarWallet({ xlmStroops: 12n * 1_000_000n }), bitcoin: null } })),
  define("B11", "Stellar wrong network", () => borrowNew({ wallets: wrongNetwork })),
  define("B12", "Bitcoin not connected", () => borrowNew({ wallets: STELLAR_ONLY })),
  define("B13", "Bitcoin wrong network", () =>
    borrowNew({ wallets: { ...BOTH_WALLETS, bitcoin: bitcoinWallet({ network: "mainnet" }) } }),
  ),
  define("B14", "Bitcoin balance below amount", () =>
    borrowNew({ wallets: { ...BOTH_WALLETS, bitcoin: bitcoinWallet({ balanceSats: 0n }) } }),
  ),
  define("B15", "Review", () => borrowNew({ deposit: { amountSats: 5_000_000n, reviewAcknowledged: true } })),
  define("B16", "Timelock too close", () => borrowNew({ deposit: { amountSats: 5_000_000n, timelockTooClose: true } })),
  define("B17", "Awaiting Xverse", () =>
    borrowNew({ flow: flow("deposit", "awaiting_signature", { phase: "awaiting_signature", wallet: "bitcoin" }) }),
  ),
  define("B18", "Xverse rejected", () =>
    borrowNew({ flow: flow("deposit", "signature_cancelled", { phase: "signature_cancelled", wallet: "bitcoin" }) }),
  ),
  define("B19", "BTC sent, saving", (now) =>
    borrowNew({ positions: [deposits.sent(1, now)], flow: flow("deposit", "preparing", { phase: "preparing", step: "locating_output" }) }),
  ),
  define("B20", "In mempool, 0 of m", (now) => borrowNew({ positions: [deposits.sent(1, now)] })),
  define("B21", "Confirming n of m (m > 1)", (now) => borrowNew({ positions: [deposits.confirming(1, now, 3, 2)] })),
  define("B22", "Not seen after 10 minutes", (now) => borrowNew({ positions: [deposits.unseen(1, now)] })),
  define("B23", "Relayer unreachable while waiting", (now) =>
    borrowNew({ globals: { relayerUnreachable: true }, positions: [deposits.relayerUnreachable(1, now)] }),
  ),
  define("B24", "m of m, relayer behind", (now) => borrowNew({ positions: [deposits.relayerBehind(1, now)] })),
  define("B25", "Ready to register", (now) => borrowNew({ positions: [deposits.ready(1, now)] })),
  define("B26", "Preparing the deposit", (now) =>
    borrowNew({ positions: [deposits.ready(1, now)], flow: flow("deposit", "preparing") }),
  ),
  define("B27", "Awaiting Stellar signature", (now) =>
    borrowNew({ positions: [deposits.ready(1, now)], flow: flow("deposit", "awaiting_signature") }),
  ),
  define("B28", "Stellar signature cancelled", (now) =>
    borrowNew({ positions: [deposits.ready(1, now)], flow: flow("deposit", "signature_cancelled") }),
  ),
  define("B29", "Submitted, recording on Stellar", (now) =>
    borrowNew({ positions: [deposits.registering(1, now, false)], flow: flow("deposit", "submitted") }),
  ),
  define("B30", "Recorded, saving the loan", (now) =>
    borrowNew({
      positions: [deposits.registering(1, now, true)],
      flow: flow("deposit", "submitted", { phase: "post_processing", step: "finalize", hash: STELLAR_TX }),
    }),
  ),
  define("B31", "Recorded, saving the loan failed", (now) =>
    borrowNew({ positions: [deposits.registering(1, now, true)], flow: flow("deposit", "needs_attention") }),
  ),
  define("B32", "Already registered on resume", (now) => borrowNew({ positions: [deposits.alreadyRegistered(1, now)] })),
  define("B33", "Done", (now) =>
    borrowNew({ positions: [loans.neverBorrowed(1, now)], deposit: { done: true }, flow: flow("deposit", "confirmed") }),
  ),
  define("B34", "New device, I already sent BTC", () =>
    borrowNew({ deposit: { newDeviceTxid: { txid: btcTxid(1), paysLock: true } } }),
  ),
  define("B35", "New device, txid does not pay this lock", () =>
    borrowNew({ deposit: { newDeviceTxid: { txid: btcTxid(9), paysLock: false } } }),
  ),
  define("B36", "Deposits unavailable (config)", () => borrowNew({ deposit: { unavailable: true } })),
  define("B37", "Second deposit while one pending", (now) =>
    borrowNew({ positions: [deposits.confirming(1, now)], deposit: { secondBlocked: true } }),
  ),
];

const LOAN: Scenario[] = [
  define("L1", "Checking", (now) => loanWorld(loans.checking(1, now))),
  define("L2", "Open, no debt", (now) => loanWorld(loans.neverBorrowed(1, now), {}, { panel: "borrow" })),
  define("L3", "Healthy", (now) => loanWorld(loans.healthy(1, now))),
  define("L4", "Below borrow limit", (now) => loanWorld(loans.belowLimit(1, now))),
  define("L5", "At risk", (now) => loanWorld(loans.atRisk(1, now), {}, { panel: "repay" })),
  define("L6", "Liquidatable", (now) => loanWorld(loans.liquidatable(1, now), {}, { panel: "repay" })),
  define("L7", "No trustline (borrow)", (now) =>
    loanWorld(loans.neverBorrowed(1, now), {}, { panel: "borrow", trustline: ok(false), walletUsdcStroops: ok(0n) }),
  ),
  define("L8", "Trustline unknown", (now) =>
    loanWorld(loans.healthy(1, now), {}, { panel: "borrow", trustline: loading(), walletUsdcStroops: loading() }),
  ),
  define("L9", "Repay with insufficient USDC", (now) =>
    loanWorld(loans.healthy(1, now), {}, { panel: "repay", walletUsdcStroops: ok(usdc(120)) }),
  ),
  define("L10", "Pool liquidity lower than ratio max", (now) =>
    loanWorld(loans.neverBorrowed(1, now), {}, { panel: "borrow", poolAvailableStroops: ok(usdc(300)) }),
  ),
  define("L11", "Action in flight", (now) => loanWorld(loans.healthy(1, now), { flow: flow("borrow", "submitted") }, { panel: "borrow" })),
  define("L12", "Repaid, waiting for Writz to co-sign", (now) =>
    loanWorld(loans.syncing(1, now), { flow: flow("repay", "confirmed", { phase: "settled", hash: STELLAR_TX }) }, { panel: "release" }),
  ),
  define("L13", "Repaid, BTC still locked", (now) => loanWorld(loans.repaidLocked(1, now), {}, { panel: "release" })),
  define("L14", "Release, wrong Bitcoin account", (now) =>
    loanWorld(
      loans.repaidLocked(1, now),
      { wallets: { ...BOTH_WALLETS, bitcoin: bitcoinWallet({ address: OTHER_BTC_ADDRESS, pubkey: "02" + "33".repeat(32) }) } },
      { panel: "release" },
    ),
  ),
  define("L15", "Release, Bitcoin wallet not connected", (now) =>
    loanWorld(loans.repaidLocked(1, now), { wallets: STELLAR_ONLY }, { panel: "release" }),
  ),
  define("L16", "Release review", (now) => loanWorld(loans.repaidLocked(1, now), {}, { panel: "release" })),
  define("L17", "Releasing (steps)", (now) =>
    loanWorld(loans.repaidLocked(1, now), { flow: flow("release", "preparing", { phase: "preparing", step: "cosign" }) }, { panel: "release" }),
  ),
  define("L18", "Released", (now) => loanWorld(loans.released(1, now))),
  define("L19", "Liquidated", (now) => loanWorld(loans.liquidated(1, now))),
  define("L20", "Liquidated, no tx found", (now) => loanWorld(loans.liquidatedNoTx(1, now))),
  define("L21", "Repaid from another device", (now) => loanWorld(loans.repaidElsewhere(1, now))),
  define("L22", "Reclaim available", (now) => loanWorld(loans.reclaimable(1, now))),
  define("L23", "Missing Bitcoin deposit details", (now) => loanWorld(loans.missingBtcDetails(1, now))),
  define("L24", "Not found (bad n)", (now) => loanWorld(loans.healthy(1, now), { route: "/loans/7" }, { n: 7 })),
  define("L25", "Not connected", () => baseWorld({ route: "/loans/1", wallets: NO_WALLETS, loan: loanPage() })),
  define("L26", "Receive as: USDC, XLM or USDC on Base Sepolia", (now) =>
    loanWorld(loans.neverBorrowed(1, now), { receive: { api: {} } }, { panel: "borrow" }),
  ),
  define("L27", "Receive as XLM, step 2 quote", (now) =>
    loanWorld(loans.healthy(1, now), { receive: receiveSeed("xlm", "idle"), flow: borrowSettled }, { panel: "borrow" }),
  ),
  define("L28", "Receive as XLM, step 2 failed (recovery)", (now) =>
    loanWorld(loans.healthy(1, now), { receive: receiveSeed("xlm", "failed"), flow: borrowSettled }, { panel: "borrow" }),
  ),
  define("L29", "Receive as XLM, step 2 skipped (recovery)", (now) =>
    loanWorld(loans.healthy(1, now), { receive: receiveSeed("xlm", "skipped"), flow: borrowSettled }, { panel: "borrow" }),
  ),
  define("L30", "Receive as XLM, swapped", (now) =>
    loanWorld(loans.healthy(1, now), { receive: receiveSeed("xlm", "done"), flow: borrowSettled }, { panel: "borrow" }),
  ),
  define("L31", "Base Sepolia, step 2 send", (now) =>
    loanWorld(loans.healthy(1, now), { receive: receiveSeed("base", "idle"), flow: borrowSettled }, { panel: "borrow" }),
  ),
  define("L32", "Base Sepolia, Circle confirming", (now) =>
    loanWorld(loans.healthy(1, now), { receive: receiveSeed("base", "sent"), flow: borrowSettled }, { panel: "borrow" }),
  ),
  define("L33", "Base Sepolia, arrived", (now) =>
    loanWorld(
      loans.healthy(1, now),
      { receive: receiveSeed("base", "sent", { kind: "arrived", mintHash: "ba".repeat(32) }), flow: borrowSettled },
      { panel: "borrow" },
    ),
  ),
  define("L34", "Base Sepolia address invalid", (now) =>
    loanWorld(
      loans.neverBorrowed(1, now),
      { receive: { api: {}, seed: { option: "base", to: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD", amountStroops: 0n } } },
      { panel: "borrow" },
    ),
  ),
  define("L35", "Full cycle timeline, received as XLM", (now) =>
    loanWorld(loans.released(1, now), {
      receive: {
        api: {},
        timeline: [
          { kind: "btc_lock", chain: "bitcoin", hash: btcTxid(1), at: null },
          { kind: "verified", chain: "stellar", hash: STELLAR_TX, at: now - 3 * 86_400_000 },
          { kind: "borrowed", chain: "stellar", hash: "b1".repeat(32), at: now - 3 * 86_400_000 + 600_000 },
          { kind: "received", chain: "stellar", hash: "5a".repeat(32), at: now - 3 * 86_400_000 + 700_000, detail: "as XLM" },
          { kind: "repaid", chain: "stellar", hash: "e1".repeat(32), at: now - 86_400_000 },
          { kind: "released", chain: "bitcoin", hash: "f1".repeat(32), at: null },
        ],
      },
    }),
  ),
];

const EARN: Scenario[] = [
  define("E1", "Disconnected", () =>
    earn({ trustline: loading(), walletStroops: loading(), vaultStroops: loading(), earnedStroops: loading() }, { wallets: NO_WALLETS }),
  ),
  define("E2", "Checking balance", () => earn({ vaultStroops: loading(), earnedStroops: loading() })),
  define("E3", "No Blend USDC trustline", () => earn({ trustline: ok(false), walletStroops: ok(0n), vaultStroops: ok(0n), earnedStroops: ok(0n) })),
  define("E4", "Trustline, 0 balance", () => earn({ walletStroops: ok(0n), vaultStroops: ok(0n), earnedStroops: ok(0n) })),
  define("E5", "Wallet balance, nothing in vault", () => earn({ vaultStroops: ok(0n), earnedStroops: ok(0n) })),
  define("E6", "Has vault balance", () => earn()),
  define("E7", "Deposit or withdraw in flight", () => earn({}, { flow: flow("earn_deposit", "submitted") })),
  define("E8", "Done", () => earn({}, { flow: flow("earn_deposit", "confirmed") })),
  define("E9", "Read failure", (now) =>
    earn({ vaultStroops: failed(usdc(1003.412), now - 5 * 60_000), earnedStroops: failed(usdc(3.412), now - 5 * 60_000) }),
  ),
  define("E10", "Strategy paused", () => earn({ strategyPaused: true })),
  define("E11", "Unfunded or wrong network", () => earn({}, { wallets: unfunded })),
];

const LEND: Scenario[] = [
  define("N1", "Disconnected", () =>
    lend({ trustline: loading(), walletUsdcStroops: loading(), suppliedStroops: loading() }, { wallets: NO_WALLETS }),
  ),
  define("N2", "Checking balances", () => lend({ walletUsdcStroops: loading(), suppliedStroops: loading(), pool: loading() })),
  define("N3", "No USDC trustline", () => lend({ trustline: ok(false), walletUsdcStroops: ok(0n), suppliedStroops: ok(0n) })),
  define("N4", "Trustline unknown", () => lend({ trustline: loading() })),
  define("N5", "Trustline, no wallet USDC, nothing supplied", () => lend({ walletUsdcStroops: ok(0n), suppliedStroops: ok(0n) })),
  define("N6", "Wallet USDC, nothing supplied", () => lend({ suppliedStroops: ok(0n) })),
  define("N7", "Has supply balance", () => lend()),
  define("N8", "Supply over wallet balance", () => lend({ inputError: "over_wallet" })),
  define("N9", "Withdraw over supplied", () => lend({ inputError: "over_supply" })),
  define("N10", "Withdraw limited by pool liquidity", () =>
    lend({ pool: ok({ ...POOL, available: usdc(800), totalBorrowed: POOL.totalSupplied - usdc(800) }) }),
  ),
  define("N11", "Pool liquidity 0", () => lend({ pool: ok({ ...POOL, available: 0n, totalBorrowed: POOL.totalSupplied }) })),
  define("N12", "Awaiting signature", () => lend({}, { flow: flow("supply", "awaiting_signature") })),
  define("N13", "Signature cancelled", () => lend({}, { flow: flow("supply", "signature_cancelled") })),
  define("N14", "Submitted or confirming", () => lend({}, { flow: flow("supply", "confirming") })),
  define("N15", "Confirmed", () => lend({}, { flow: flow("supply", "confirmed") })),
  define("N16", "Timed out", () => lend({}, { flow: flow("withdraw", "timed_out") })),
  define("N17", "Failed", () => lend({}, { flow: flow("withdraw", "failed") })),
  define("N18", "Read failure", (now) =>
    lend({ suppliedStroops: failed(usdc(2500), now - 5 * 60_000), pool: failed(POOL, now - 5 * 60_000) }),
  ),
  define("N19", "Unfunded or wrong network", () => lend({}, { wallets: wrongNetwork })),
];

const PROTOCOL: Scenario[] = [
  define("P1", "Loaded", () => protocol()),
  define("P2", "Partial read failure", () => protocol({ vault: failed() })),
  define("P3", "All reads failed", () => protocol({ pool: failed(), vault: failed() })),
  define("P4", "No vault deposits", () => protocol({ vault: ok({ totalStroops: 0n, depositors: 0, apy: 0.0731 }) })),
  define("P5", "Cohort under 30 days", () => protocol({ cohortDays: 12 })),
];

const HELP: Scenario[] = [
  define("R1", "Timelock in the future", () => help()),
  define("R2", "Timelock reached", () => help({ reclaim: { timelockHeight: TIP - 10 } })),
  define("R3", "Tip unknown", () => help({ chain: { btcTipHeight: undefined } })),
  define("R4", "Visited from a loan", (now) =>
    help({
      wallets: BOTH_WALLETS,
      positions: [loans.repaidLocked(1, now)],
      reclaim: { timelockHeight: TIMELOCK, loan: { n: 1, p2wsh: LOCK_ADDRESS, txid: btcTxid(1) } },
    }),
  ),
];

const LIFECYCLE: TxLifecycleId[] = [
  "draft",
  "preparing",
  "awaiting_signature",
  "signature_cancelled",
  "submitted",
  "confirming",
  "confirmed",
  "timed_out",
  "failed",
  "needs_attention",
];

const TX: Scenario[] = LIFECYCLE.map((id) =>
  define(`tx.${id}`, `Transaction ${id.replace(/_/g, " ")}`, (now) =>
    loanWorld(loans.healthy(1, now), {
      flow: flow(id === "needs_attention" ? "deposit" : "borrow", id),
      activity:
        id === "submitted" || id === "confirming" || id === "timed_out"
          ? [{ hash: STELLAR_TX, kind: "borrow", createdAt: now - (id === "timed_out" ? 400_000 : 20_000) }]
          : [],
    }),
  ),
);

const statusRow = (kind: string, build: (now: number) => MockPosition): Scenario =>
  define(`status.${kind}`, `Position status ${kind}`, (now) => loanWorld(build(now)));

const STATUS: Scenario[] = [
  statusRow("checking", (now) => loans.checking(1, now)),
  statusRow("btc_sent", (now) => deposits.sent(1, now)),
  statusRow("btc_unseen", (now) => deposits.unseen(1, now)),
  statusRow("confirming", (now) => deposits.confirming(1, now)),
  statusRow("ready_to_register", (now) => deposits.ready(1, now)),
  statusRow("registering", (now) => deposits.registering(1, now, true)),
  statusRow("active", (now) => loans.healthy(1, now)),
  statusRow("at_risk", (now) => loans.atRisk(1, now)),
  statusRow("liquidatable", (now) => loans.liquidatable(1, now)),
  statusRow("repaid_locked", (now) => loans.repaidLocked(1, now)),
  statusRow("releasing", (now) => loans.releasing(1, now)),
  statusRow("released", (now) => loans.released(1, now)),
  statusRow("liquidated", (now) => loans.liquidated(1, now)),
  statusRow("reclaimable", (now) => loans.reclaimable(1, now)),
  statusRow("syncing", (now) => loans.syncing(1, now)),
];

export const SCENARIOS: readonly Scenario[] = [
  ...GLOBAL,
  ...HOME,
  ...DEPOSIT,
  ...LOAN,
  ...EARN,
  ...LEND,
  ...PROTOCOL,
  ...HELP,
  ...TX,
  ...STATUS,
];

const BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));

export function getScenario(id: string): Scenario | null {
  return BY_ID.get(id) ?? null;
}
