"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getPoolState } from "@/lib/contracts/commitmentTree";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { ensureKit } from "@/lib/wallet/kit";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { isInFlight, type Emit } from "@/lib/flow/engine";
import { useFlow, useTxLockState } from "@/lib/flow/useFlow";
import { locks } from "@/lib/flow/lock";
import { activity } from "@/lib/flow/pendingTx";
import { pendingDeposits } from "@/lib/flow/pendingDeposit";
import { borrow as borrowFlow } from "@/lib/flows/borrow";
import { repay as repayFlow } from "@/lib/flows/repay";
import { releaseBtc, releaseFeeEstimate } from "@/lib/flows/release";
import { reconcileActivity, syncLeafUpdates } from "@/lib/flows/positionTx";
import { recoverPositions } from "@/lib/flows/recover";
import { enableTrustline, getAssetBalance, POOL_ASSET } from "@/lib/flows/trustline";
import { formatUsdc } from "@/lib/borrow/journey";
import { loanActivity, type LoanTab, type Read, type RecentTx } from "@/lib/loan/model";
import { EMPTY_POSITIONS, importPositions, positionsSnapshot, subscribePositions, type Position } from "@/lib/position";
import { defaultStatusSource, usePositionStatus, useRefreshStatus } from "@/lib/status/provider";
import type { LocalInputs } from "@/lib/status/types";
import { useSteadyStatus, type LoanAccess, type LoanModel } from "./model";

const NO_TXS: never[] = [];
const LEAF_RETRY_MS = 15_000;

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
  const position = positions.find((p) => p.index === n - 1 && p.status !== "pending") ?? null;
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
  const leaves = useSyncExternalStore(
    activity.subscribe,
    () => (address ? activity.leafSnapshot(address) : null),
    () => null,
  );

  useEffect(() => {
    if (!address) return;
    void reconcileActivity(address)
      .then(() => syncLeafUpdates(address))
      .catch(() => {});
  }, [address]);

  // ── Finding the loan ──
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<unknown>(null);
  const [recovered, setRecovered] = useState<{ seed: Uint8Array; done: true } | null>(null);
  useEffect(() => {
    const seed = w.seed;
    if (!address || !seed || position) return;
    let live = true;
    recoverPositions({ owner: address, seed })
      .catch(() => {})
      .finally(() => live && setRecovered({ seed, done: true }));
    return () => {
      live = false;
    };
    // Recover once per seed when the loan isn't on this device yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, w.seed]);
  const finding = !position && Boolean(w.seed) && !(recovered?.seed === w.seed && recovered.done);
  const access: LoanAccess = !address ? "disconnected" : position ? "ready" : !w.seed ? "locked" : finding ? "finding" : "ready";

  // ── Status ──
  const myPending = useMemo(
    () => (position ? pendingTxs.filter((t) => t.positionUpdate?.save.index === position.index) : NO_TXS),
    [pendingTxs, position],
  );
  const local = useMemo<LocalInputs | null>(
    () => (position ? { position, pendingDeposit: null, pendingTxs: myPending } : null),
    [position, myPending],
  );
  const status = useSteadyStatus(usePositionStatus(local, 20_000), position ? `${address}:${position.index}` : null);
  const refreshStatus = useRefreshStatus();

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
  const leafPending = Boolean(
    position?.leafIndex !== undefined && leaves?.some((u) => u.leafIndex === position.leafIndex),
  );
  useEffect(() => {
    if (!address || !leafPending) return;
    const id = setInterval(() => void syncLeafUpdates(address).catch(() => {}), LEAF_RETRY_MS);
    return () => clearInterval(id);
  }, [address, leafPending]);

  // ── Actions ──
  const run = useCallback(
    async (tab: LoanTab, fn: (position: Position, emit: Emit) => Promise<RecentTx | null>) => {
      if (!address || !position) return;
      setAction(tab);
      emit({ type: "start" });
      try {
        const done = await locks().withTxLock(address, () => fn(position, emit));
        if (done) setRecent((r) => [done, ...r]);
      } catch (e) {
        emit({ type: "failed", error: e });
      } finally {
        refresh();
      }
    },
    [address, position, emit, refresh],
  );

  const seed = w.seed;
  const borrow = useCallback(
    (amountStroops: bigint) => {
      if (!seed || !address) return;
      setLastAmount(amountStroops);
      void run("borrow", async (p, e) => {
        const r = await borrowFlow({ position: p, amountStroops, borrower: address, seed, signTransaction: w.signTransaction, emit: e });
        return r.txHash ? { hash: r.txHash, chain: "stellar", label: `Borrowed ${formatUsdc(amountStroops)} USDC`, at: Date.now() } : null;
      });
    },
    [seed, address, run, w.signTransaction],
  );

  const repay = useCallback(
    (amountStroops: bigint) => {
      if (!seed || !address) return;
      setLastAmount(amountStroops);
      void run("repay", async (p, e) => {
        const r = await repayFlow({ position: p, amountStroops, repayer: address, seed, signTransaction: w.signTransaction, emit: e });
        return r.txHash ? { hash: r.txHash, chain: "stellar", label: `Repaid ${formatUsdc(amountStroops)} USDC`, at: Date.now() } : null;
      });
    },
    [seed, address, run, w.signTransaction],
  );

  const recipient = b.btcAddress;
  const feeSats = fee.kind === "ok" ? fee.value : null;
  const release = useCallback(() => {
    if (!seed || !recipient) return;
    setLastAmount(null);
    void run("release", async (p, e) => {
      const { btcTxid } = await releaseBtc({
        position: p,
        seed,
        recipient,
        signPsbt: b.signPsbt,
        emit: e,
        feeSat: feeSats ?? undefined,
      });
      return { hash: btcTxid, chain: "bitcoin", label: "Release sent to Bitcoin", at: Date.now() };
    });
  }, [seed, recipient, run, b.signPsbt, feeSats]);

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

  const [importState, setImportState] = useState<{ busy: boolean; error: unknown; done: boolean }>({
    busy: false,
    error: null,
    done: false,
  });
  const importBackup = useCallback(
    (file: File) => {
      setImportState({ busy: true, error: null, done: false });
      file
        .text()
        .then((text) => {
          const { owner } = importPositions(text);
          if (owner !== address) throw new Error("This backup belongs to a different Stellar wallet.");
          setImportState({ busy: false, error: null, done: true });
        })
        .catch((error: unknown) => setImportState({ busy: false, error, done: false }));
    },
    [address],
  );

  const walletName = w.walletBackend === "privy" ? "Privy" : (kitWalletName() ?? "your wallet");

  return {
    n,
    access,
    stellar: {
      walletName,
      connecting: w.connecting,
      connect: () => void w.connect(),
      keysReady: Boolean(seed),
      unlocking,
      unlockError,
      unlock: () => {
        setUnlockError(null);
        setUnlocking(true);
        w.unlock()
          .catch((e: unknown) => setUnlockError(e))
          .finally(() => setUnlocking(false));
      },
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
    catchingUp: status.syncing || leafPending,
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
      if (address) void reconcileActivity(address).finally(refresh);
      refreshStatus(local);
    },
    importBackup,
    importState,
  };
}
