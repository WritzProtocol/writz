"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Horizon, NotFoundError } from "@stellar/stellar-sdk";
import { config } from "@/config";
import { MAINNET_PASSPHRASE } from "@/config/target";
import { useWallet, type PollarLogin } from "@/lib/wallet/WalletProvider";
import { ensureKit } from "@/lib/wallet/kit";
import { networkName } from "@/lib/wallet/precheck";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { useAnyFlowBusy } from "@/lib/activity";
import { pendingDeposits, type PendingDeposit } from "@/lib/flow/pendingDeposit";
import { useTxLockState } from "@/lib/flow/useFlow";
import { activity, type PendingTx } from "@/lib/flow/pendingTx";
import { getAssetBalance, POOL_ASSET } from "@/lib/flows/trustline";
import { discoverPositions } from "@/lib/flows/discover";
import { reconcileActivity } from "@/lib/flows/positionTx";
import { btcBalanceOf, fundingOf, type Funding } from "@/lib/borrow/journey";
import type { Read, RecentTx } from "@/lib/loan/model";
import { EMPTY_POSITIONS, exportPositions, positionsSnapshot, subscribePositions, type Position } from "@/lib/position";
import { recentActivity } from "@/lib/tray";
import type { MockWorld, Reading } from "@/lib/mock/types";
import { usePositionStatuses } from "@/lib/status/provider";
import type { LocalInputs } from "@/lib/status/types";
import type { HomeDeposit, HomeLoan } from "@/lib/home/model";
import { useMounted, useRead, useMockWorld } from "@/components/ui/hooks";

export type LoansState = "disconnected" | "finding" | "found" | "failed";

export interface ShellAccount {
  mock: boolean;
  stellar: {
    address: string | null;
    walletName: string;
    connecting: boolean;
    wrongNetwork: string | null;
    funding: Read<Funding>;
    fundBusy: boolean;
    usdcAdded: Read<boolean>;
    switchedFrom: string | null;
    /** Pollar pays the network fees of the wallet it created, so low XLM is not a problem. */
    feesSponsored: boolean;
    connect(): void;
    /** Email, Google and GitHub sign-in, or null when it is not offered. */
    pollar: PollarLogin | null;
    disconnect(): void;
    fund(): void;
  };
  bitcoin: {
    address: string | null;
    connecting: boolean;
    balance: Read<bigint>;
    connect(): void;
    disconnect(): void;
  };
  loans: { state: LoansState; error: unknown; retry(): void };
  positions: readonly Position[];
  loanStatuses: readonly HomeLoan[];
  pendingDeposit: PendingDeposit | null;
  deposit: HomeDeposit | null;
  pendingTxs: readonly PendingTx[];
  recent: readonly RecentTx[];
  busy: boolean;
  mainnetGuard: boolean;
  /** False until it is known whether a wallet is connected: before hydration and while a session restores. */
  walletsKnown: boolean;
  otherTabTx: boolean;
  rpcUnreachable: boolean;
  relayerCatchingUp: boolean;
  downloadBackup(): void;
  clearFinished(): void;
}

type BaseAccount = Omit<ShellAccount, "loanStatuses" | "deposit"> & { depositLocal: LocalInputs | null };

const AccountContext = createContext<ShellAccount | null>(null);

export function useShellAccount(): ShellAccount {
  const a = useContext(AccountContext);
  if (!a) throw new Error("useShellAccount must be used inside AccountProvider");
  return a;
}

const noop = () => {};
const NO_TXS: never[] = [];
const NO_RECENT: never[] = [];

async function loadFunding(address: string): Promise<Funding> {
  try {
    return fundingOf(await new Horizon.Server(config.horizonUrl).loadAccount(address));
  } catch (e) {
    if (e instanceof NotFoundError) return fundingOf(null);
    throw e;
  }
}

function kitWalletName(): string | undefined {
  try {
    return ensureKit().selectedModule.productName;
  } catch {
    return undefined;
  }
}

function download(owner: string) {
  const blob = new Blob([exportPositions(owner)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `writz-loans-${owner.slice(0, 6)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function useLiveAccount(): BaseAccount {
  const w = useWallet();
  const b = useBitcoinWallet();
  const address = w.address;
  const flowBusy = useAnyFlowBusy();
  const txLock = useTxLockState(address);
  const mounted = useMounted();

  // A different account while connected means it was switched in the extension.
  const [seen, setSeen] = useState<{ address: string | null; switchedFrom: string | null }>({ address, switchedFrom: null });
  if (seen.address !== address) {
    setSeen({ address, switchedFrom: seen.address && address ? seen.address : null });
  }

  const positions = useSyncExternalStore(
    subscribePositions,
    () => (address ? positionsSnapshot(address) : EMPTY_POSITIONS),
    () => EMPTY_POSITIONS,
  );
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
  const recent = useSyncExternalStore(
    recentActivity.subscribe,
    () => (address ? (recentActivity.snapshot(address) ?? NO_RECENT) : NO_RECENT),
    () => NO_RECENT,
  );

  // Transactions a closed tab left in flight.
  useEffect(() => {
    if (!address) return;
    void reconcileActivity(address).catch(() => {});
  }, [address]);

  const [network, setNetwork] = useState<{ key: string; passphrase: string | null; name?: string } | null>(null);
  useEffect(() => {
    if (!address || w.walletBackend !== "kit") return;
    let live = true;
    const check = () =>
      ensureKit()
        .getNetwork()
        .then((n) => live && setNetwork({ key: address, passphrase: n.networkPassphrase, name: kitWalletName() }))
        .catch(() => live && setNetwork({ key: address, passphrase: null, name: kitWalletName() }));
    void check();
    window.addEventListener("focus", check);
    return () => {
      live = false;
      window.removeEventListener("focus", check);
    };
  }, [address, w.walletBackend]);
  const net = network?.key === address ? network : null;
  const wrongNetwork = net?.passphrase && net.passphrase !== config.networkPassphrase ? networkName(net.passphrase) : null;
  const walletName = w.walletBackend === "pollar" ? "Pollar" : (net?.name ?? "your wallet");

  const [nonce, setNonce] = useState(0);
  // A Pollar account lands on the ledger after sign-in; read it again once it does.
  const provisioning = w.walletBackend === "pollar" ? w.pollar?.session.provisioning : null;
  const funding = useRead(address ? `fund:${address}:${nonce}:${provisioning}` : null, () => loadFunding(address!));
  const trust = useRead(address ? `usdc:${address}:${nonce}` : null, () => getAssetBalance(address!, POOL_ASSET));
  const usdcAdded: Read<boolean> = trust.kind === "ok" ? { kind: "ok", value: trust.value !== null } : trust;
  const btcAddress = b.btcAddress;
  const balance = useRead(btcAddress ? `btc:${btcAddress}:${nonce}` : null, async () => {
    const r = await fetch(`${config.bitcoin.apiUrl}/address/${btcAddress}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return btcBalanceOf(await r.json());
  });

  const [fundBusy, setFundBusy] = useState(false);
  const fund = useCallback(() => {
    if (!address) return;
    setFundBusy(true);
    fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`)
      .catch(() => {})
      .finally(() => {
        setFundBusy(false);
        setNonce((n) => n + 1);
      });
  }, [address]);

  // Loans are public on chain: finding them needs only the connected address, no signature.
  const [find, setFind] = useState<{ key: string; state: "found" | "failed"; error?: unknown } | null>(null);
  const [findNonce, setFindNonce] = useState(0);
  const findKey = address ? `${address}:${findNonce}` : null;
  useEffect(() => {
    if (!address) return;
    let live = true;
    const key = `${address}:${findNonce}`;
    discoverPositions(address)
      .then(() => live && setFind({ key, state: "found" }))
      .catch((error: unknown) => live && setFind({ key, state: "failed", error }));
    return () => {
      live = false;
    };
  }, [address, findNonce]);
  const findState = find?.key === findKey ? find : null;
  const loansState: LoansState = !address ? "disconnected" : (findState?.state ?? "finding");

  return {
    mock: false,
    stellar: {
      address,
      walletName,
      connecting: w.connecting,
      wrongNetwork,
      funding,
      fundBusy,
      usdcAdded,
      switchedFrom: seen.address === address ? seen.switchedFrom : null,
      feesSponsored: w.walletBackend === "pollar",
      connect: () => void w.connect(),
      pollar: w.pollar,
      disconnect: w.disconnect,
      fund,
    },
    bitcoin: {
      address: btcAddress,
      connecting: b.connecting,
      balance,
      connect: () => void b.connect(),
      disconnect: b.disconnect,
    },
    loans: {
      state: loansState,
      error: findState?.state === "failed" ? findState.error : null,
      retry: () => setFindNonce((n) => n + 1),
    },
    positions,
    pendingDeposit,
    depositLocal: pendingDeposit ? { position: null, pendingDeposit } : null,
    pendingTxs,
    recent,
    busy: flowBusy || Boolean(pendingDeposit) || pendingTxs.length > 0,
    mainnetGuard: config.networkPassphrase === MAINNET_PASSPHRASE,
    walletsKnown: mounted && !w.restoring,
    otherTabTx: txLock === "elsewhere",
    rpcUnreachable: false,
    relayerCatchingUp: false,
    downloadBackup: () => address && download(address),
    clearFinished: () => address && recentActivity.clear(address),
  };
}

const fromReading = <T,>(r: Reading<T> | undefined, fallback: Read<T>): Read<T> =>
  !r ? fallback : r.state === "loading" ? { kind: "checking" } : r.state === "failed" ? { kind: "failed" } : { kind: "ok", value: r.value };

function mockAccount(world: MockWorld): BaseAccount {
  const sw = world.wallets.stellar;
  const bw = world.wallets.bitcoin;
  const positions = world.positions.flatMap((p) => (p.local.position ? [p.local.position] : []));
  const depositLocal = world.positions.find((p) => p.local.pendingDeposit && !p.local.position)?.local ?? null;
  const pendingDeposit = depositLocal?.pendingDeposit ?? null;
  const loans: LoansState = !sw ? "disconnected" : sw.loans;
  return {
    mock: true,
    stellar: {
      address: sw?.address ?? null,
      walletName: "Freighter",
      connecting: world.wallets.connect?.wallet === "stellar" && world.wallets.connect.state === "awaiting",
      wrongNetwork: sw?.network === "PUBLIC" ? "Stellar mainnet" : null,
      funding: sw ? { kind: "ok", value: fundingOf(sw.xlmStroops === null ? null : { balances: [{ asset_type: "native", balance: (Number(sw.xlmStroops) / 1e7).toFixed(7) }] }) } : { kind: "checking" },
      fundBusy: false,
      usdcAdded: fromReading(world.loan?.trustline ?? world.earn?.trustline ?? world.lend?.trustline, { kind: "ok", value: true }),
      switchedFrom: sw?.switchedFrom ?? null,
      feesSponsored: false,
      connect: noop,
      pollar: null,
      disconnect: noop,
      fund: noop,
    },
    bitcoin: {
      address: bw?.address ?? null,
      connecting: world.wallets.connect?.wallet === "bitcoin" && world.wallets.connect.state === "awaiting",
      balance: bw ? { kind: "ok", value: bw.balanceSats } : { kind: "checking" },
      connect: noop,
      disconnect: noop,
    },
    loans: { state: loans, error: sw?.loans === "failed" ? new Error("Horizon error 503") : null, retry: noop },
    positions,
    pendingDeposit,
    depositLocal,
    pendingTxs: world.activity,
    recent: NO_RECENT,
    busy: Boolean(pendingDeposit) || world.activity.length > 0,
    mainnetGuard: Boolean(world.globals.mainnetGuard),
    walletsKnown: !world.globals.hydrating,
    otherTabTx: Boolean(world.globals.otherTabTx),
    rpcUnreachable: Boolean(world.globals.rpcUnreachable),
    relayerCatchingUp: Boolean(world.globals.relayerCatchingUp),
    downloadBackup: noop,
    clearFinished: noop,
  };
}

function useWithStatuses(base: BaseAccount): ShellAccount {
  const { positions, pendingTxs, depositLocal } = base;
  const open = positions;
  const locals = useMemo<LocalInputs[]>(() => {
    const list: LocalInputs[] = open.map((position) => ({
      position,
      pendingDeposit: null,
      pendingTxs: pendingTxs.filter((t) => t.positionUpdate?.save.index === position.index),
    }));
    return depositLocal ? [...list, depositLocal] : list;
  }, [open, pendingTxs, depositLocal]);
  const statuses = usePositionStatuses(locals);
  const loanStatuses = useMemo(() => open.map((position, i) => ({ position, derived: statuses[i] })), [open, statuses]);
  const deposit = useMemo(
    () => (base.pendingDeposit && depositLocal ? { pd: base.pendingDeposit, derived: statuses[open.length] } : null),
    [base.pendingDeposit, depositLocal, statuses, open.length],
  );
  const relayerCatchingUp = base.relayerCatchingUp || loanStatuses.some((l) => l.derived.syncing);
  return { ...base, loanStatuses, deposit, relayerCatchingUp };
}

function LiveAccount({ children }: { children: React.ReactNode }) {
  const value = useWithStatuses(useLiveAccount());
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

function MockAccount({ world, children }: { world: MockWorld; children: React.ReactNode }) {
  const value = useWithStatuses(useMemo(() => mockAccount(world), [world]));
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const world = useMockWorld();
  return world ? <MockAccount world={world}>{children}</MockAccount> : <LiveAccount>{children}</LiveAccount>;
}
