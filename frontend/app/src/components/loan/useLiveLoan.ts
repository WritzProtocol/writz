"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getPoolState } from "@/lib/contracts/writzLend";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { ensureKit } from "@/lib/wallet/kit";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { isInFlight, type Emit } from "@/lib/flow/engine";
import { useFlow, useTxLockState } from "@/lib/flow/useFlow";
import { locks } from "@/lib/flow/lock";
import { activity } from "@/lib/flow/pendingTx";
import { pendingDeposits } from "@/lib/flow/pendingDeposit";
import { recentActivity } from "@/lib/tray";
import { currentRoute, notifySettled } from "@/lib/toast";
import { borrow as borrowFlow } from "@/lib/flows/borrow";
import { repay as repayFlow } from "@/lib/flows/repay";
import { releaseBtc, releaseFeeEstimate } from "@/lib/flows/release";
import { reconcileActivity } from "@/lib/flows/positionTx";
import { discoverPositions, syncPosition } from "@/lib/flows/discover";
import { enableTrustline, getAssetBalance, POOL_ASSET } from "@/lib/flows/trustline";
import { formatUsdc } from "@/lib/borrow/journey";
import { loanActivity, type LoanTab, type Read, type RecentTx } from "@/lib/loan/model";
import { EMPTY_POSITIONS, positionsSnapshot, subscribePositions, type Position } from "@/lib/position";
import { defaultStatusSource, usePositionStatus, useRefreshStatus } from "@/lib/status/provider";
import type { LocalInputs } from "@/lib/status/types";
import { useSteadyStatus, type LoanAccess, type LoanModel } from "./model";

const NO_TXS: never[] = [];

function settledText(tab: LoanTab, done: RecentTx, n: number): string {
  if (tab === "borrow") return `${done.label} on Loan ${n}. It's in your Stellar wallet.`;
  if (tab === "repay") return `${done.label} on Loan ${n}.`;
  return `Release of Loan ${n} sent to Bitcoin. It arrives after 1 Bitcoin confirmation.`;
}

const WHAT: Record<LoanTab, string> = { borrow: "Your borrow", repay: "Your repayment", release: "Your release" };

function kitWalletName(): string | undefined {
  try {
    return ensureKit().selectedModule.productName;
  } catch {
    return undefined;
  }
}

/** A read that starts over whenever `key` changes, so a stale answer never shows for another wallet. */
function useRead<T>(key: string | null, load: () => Promise<T>): Read<T> {
  const [state, setState] = useState<{ key: string; value: Read<T> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    load()
      .then((value) => live && setState({ key, value: { kind: "ok", value } }))
      .catch(() => live && setState({ key, value: { kind: "failed" } }));
    return () => {
      live = false;
    };
    // `load` is keyed by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && state?.key === key ? state.value : { kind: "checking" };
}

export function useLiveLoan(n: number, requestedPanel: LoanTab | null): LoanModel {
  const w = useWallet();
  const b = useBitcoinWallet();
  const address = w.address;
  const [flow, emit] = useFlow();
  const [action, setAction] = useState<LoanTab | null>(null);
  const [lastAmount, setLastAmount] = useState<bigint | null>(null);
  const [recent, setRecent] = useState<RecentTx[]>([]);
  const [nonce, setNonce] = useState(0);
  const [now] = useState(() => Date.now());
  const refresh = useCallback(() => setNonce((x) => x + 1), []);

  const positions = useSyncExternalStore(
    subscribePositions,
    () => (address ? positionsSnapshot(address) : EMPTY_POSITIONS),
    () => EMPTY_POSITIONS,
  );
  const stored = positions.find((p) => p.index === n - 1) ?? null;
  const pendingDeposit = useSyncExternalStore(
    pendingDeposits.subscribe,
    () => (address ? pendingDeposits.snapshot(address) : null),
    () => null,
  );
  const pendingTxs = useSyncExternalStore(
    activity.subscribe,
    () => (address ? (activity.txSnapshot(address) ?? NO_TXS) : NO_TXS),
    () => NO_TXS,
  );

  useEffect(() => {
    if (!address) return;
    void reconcileActivity(address).catch(() => {});
  }, [address]);

  // ── Finding the loan: from the chain when this device doesn't have it yet ──
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    if (!address || stored) return;
    let live = true;
    discoverPositions(address)
      .catch(() => {})
      .finally(() => live && setFound(address));
    return () => {
      live = false;
    };
    // Look once per wallet when the loan isn't on this device yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);
  const access: LoanAccess = !address ? "disconnected" : stored || found === address ? "ready" : "finding";

  // ── Status ──
  const myPending = useMemo(
    () => (stored ? pendingTxs.filter((t) => t.positionUpdate?.save.index === stored.index) : NO_TXS),
    [pendingTxs, stored],
  );
  const local = useMemo<LocalInputs | null>(
    () => (stored ? { position: stored, pendingDeposit: null, pendingTxs: myPending } : null),
    [stored, myPending],
  );
  const status = useSteadyStatus(usePositionStatus(local, 20_000), stored ? `${address}:${stored.index}` : null);
  const refreshStatus = useRefreshStatus();
  // The loan as the chain holds it: amounts and debt with interest from the last status read.
  const onChain = status.onChain;
  const position = useMemo<Position | null>(
    () =>
      stored && onChain
        ? { ...stored, collateralSats: onChain.collateralSats.toString(), debtStroops: onChain.debtStroops.toString() }
        : stored,
    [stored, onChain],
  );

  // ── Reads ──
  const [priceNonce, setPriceNonce] = useState(0);
  const price = useRead(`price:${priceNonce}`, () => defaultStatusSource().getOraclePrice());
  const pool = useRead(`pool:${nonce}`, async () => (await getPoolState()).available);
  const balance = useRead(address ? `usdc:${address}:${nonce}` : null, () => getAssetBalance(address!, POOL_ASSET));
  const trustline: Read<boolean> = balance.kind === "ok" ? { kind: "ok", value: balance.value !== null } : balance;
  const walletUsdc: Read<bigint> = balance.kind === "ok" ? { kind: "ok", value: balance.value ?? 0n } : balance;
  const fee = useRead("release-fee", releaseFeeEstimate);

  // ── Locks and relayer sync ──
  const txLock = useTxLockState(address);
  const running = isInFlight(flow);
  const [trustBusy, setTrustBusy] = useState(false);
  const otherTx = txLock === "elsewhere" || (txLock === "here" && !running && !trustBusy);

  // ── Actions ──
  const run = useCallback(
    async (tab: LoanTab, fn: (position: Position, emit: Emit) => Promise<RecentTx | null>) => {
      if (!address || !position) return;
      setAction(tab);
      emit({ type: "start" });
      const origin = currentRoute();
      const link = { href: origin, label: `Open Loan ${n}` };
      try {
        const done = await locks().withTxLock(address, () => fn(position, emit));
        if (done) {
          setRecent((r) => [done, ...r]);
          recentActivity.add(address, done);
          notifySettled(origin, link, { ok: true, text: settledText(tab, done, n) });
        }
      } catch (e) {
        emit({ type: "failed", error: e });
        notifySettled(origin, link, { ok: false, error: e, what: `${WHAT[tab]} on Loan ${n}` });
      } finally {
        refresh();
      }
    },
    [address, position, emit, refresh, n],
  );

  const borrow = useCallback(
    (amountStroops: bigint) => {
      if (!address) return;
      setLastAmount(amountStroops);
      void run("borrow", async (p, e) => {
        const r = await borrowFlow({ position: p, amountStroops, borrower: address, signTransaction: w.signTransaction, emit: e });
        return r.txHash ? { hash: r.txHash, chain: "stellar", label: `Borrowed ${formatUsdc(amountStroops)} USDC`, at: Date.now() } : null;
      });
    },
    [address, run, w.signTransaction],
  );

  const repay = useCallback(
    (amountStroops: bigint) => {
      if (!address) return;
      setLastAmount(amountStroops);
      void run("repay", async (p, e) => {
        const r = await repayFlow({ position: p, amountStroops, repayer: address, signTransaction: w.signTransaction, emit: e });
        return r.txHash ? { hash: r.txHash, chain: "stellar", label: `Repaid ${formatUsdc(amountStroops)} USDC`, at: Date.now() } : null;
      });
    },
    [address, run, w.signTransaction],
  );

  const feeSats = fee.kind === "ok" ? fee.value : null;
  const release = useCallback(() => {
    if (!b.btcAddress || !address) return;
    setLastAmount(null);
    void run("release", async (p, e) => {
      const { btcTxid } = await releaseBtc({
        position: p,
        signPsbt: b.signPsbt,
        stellarAddress: address,
        signTransaction: w.signTransaction,
        emit: e,
      });
      return { hash: btcTxid, chain: "bitcoin", label: "Release sent to Bitcoin", at: Date.now() };
    });
  }, [b.btcAddress, address, run, b.signPsbt, w.signTransaction]);

  const [trustError, setTrustError] = useState<unknown>(null);
  const addUsdc = useCallback(async () => {
    if (!address) return;
    setTrustError(null);
    setTrustBusy(true);
    try {
      await locks().withTxLock(address, () => enableTrustline({ address, asset: POOL_ASSET, signTransaction: w.signTransaction }));
      refresh();
    } catch (e) {
      setTrustError(e);
    } finally {
      setTrustBusy(false);
    }
  }, [address, w.signTransaction, refresh]);

  const walletName = w.walletBackend === "pollar" ? "Pollar" : (kitWalletName() ?? "your wallet");

  return {
    n,
    access,
    stellar: {
      walletName,
      connecting: w.connecting,
      connect: () => void w.connect(),
    },
    position,
    depositInProgress: !position && pendingDeposit?.positionIndex === n - 1,
    status,
    price,
    pool,
    trustline,
    walletUsdc,
    bitcoin: {
      address: b.btcAddress,
      pubkey: b.btcPubkey,
      connecting: b.connecting,
      error: b.error,
      connect: () => void b.connect(),
      useOther: () => {
        b.disconnect();
        void b.connect();
      },
    },
    releaseFeeSats: feeSats,
    flow,
    action,
    lastAmount,
    trust: { busy: trustBusy, error: trustError, add: () => void addUsdc() },
    otherTx,
    catchingUp: status.syncing,
    activity: position
      ? loanActivity({
          index: position.index,
          pending: myPending,
          recent,
          stellarTxHash: position.stellarTxHash,
          releaseTxid: position.releaseTxid,
          createdAt: position.createdAt,
        })
      : [],
    requestedPanel,
    now,
    borrow,
    repay,
    release,
    dismiss: () => {
      emit({ type: "reset" });
      setAction(null);
    },
    recheckPrice: () => setPriceNonce((x) => x + 1),
    checkAgain: () => {
      if (address) {
        void reconcileActivity(address)
          .then(() => (stored ? syncPosition(address, stored.txid) : null))
          .catch(() => {})
          .finally(refresh);
      }
      refreshStatus(local);
    },
  };
}
