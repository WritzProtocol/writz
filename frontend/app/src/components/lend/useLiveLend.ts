"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { accrueBalance, getLendPool, getSupplyValue } from "@/lib/contracts/writzLend";
import { withdrawable } from "@/lib/funds/model";
import { usePolledValue } from "@/lib/earn/usePolledValue";
import { supply, withdraw } from "@/lib/flows/lend";
import { enableTrustline, getAssetBalance, POOL_ASSET } from "@/lib/flows/trustline";
import { useFlow } from "@/lib/flow/useFlow";
import { locks } from "@/lib/flow/lock";
import type { FundsSide } from "@/lib/funds/model";
import type { Read } from "@/lib/loan/model";
import { recentActivity } from "@/lib/tray";
import { currentRoute, notifySettled } from "@/lib/toast";
import { formatUsdc } from "@/lib/borrow/journey";
import { useShellAccount } from "@/components/shell/account";
import { lendSides, poolSupplyRate, type LendModel, type PoolTotals } from "./model";

const POLL_MS = 15_000;
const TICK_MS = 1_000;

/** The chain-read balance, grown locally at the current rate until the next read replaces it. */
function useAccruing(value: bigint | null, readAt: number | null, rate: number): bigint | null {
  const [now, setNow] = useState(() => Date.now());
  const active = value !== null && value > 0n && rate > 0;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [active]);
  if (value === null || readAt === null || !active) return value;
  return accrueBalance(value, rate, now - readAt);
}

/** For a poll with no value yet. */
const pending = (p: { loading: boolean }): Read<never> => (p.loading ? { kind: "checking" } : { kind: "failed" });

export function useLiveLend(): LendModel {
  const a = useShellAccount();
  const w = useWallet();
  const address = a.stellar.address;
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const readPool = useCallback(() => getLendPool(), []);
  const readSupplied = useCallback((key: string) => getSupplyValue(key.split(":")[0]!), []);
  // -1 marks "no trustline" so one read answers both questions.
  const readWallet = useCallback(async (key: string) => (await getAssetBalance(key.split(":")[0]!, POOL_ASSET)) ?? -1n, []);

  const poolPoll = usePolledValue(`pool:${nonce}`, readPool, POLL_MS);
  const suppliedPoll = usePolledValue(address ? `${address}:${nonce}` : null, readSupplied, POLL_MS);
  const walletPoll = usePolledValue(address ? `${address}:${nonce}` : null, readWallet, POLL_MS);

  const pool: Read<PoolTotals> = poolPoll.value
    ? { kind: "ok", value: poolPoll.value }
    : pending(poolPoll);
  const supplied: Read<bigint> = suppliedPoll.value !== null ? { kind: "ok", value: suppliedPoll.value } : pending(suppliedPoll);
  const rate = poolPoll.value ? poolSupplyRate(poolPoll.value) : 0;
  const accrued = useAccruing(suppliedPoll.value, suppliedPoll.updatedAt?.getTime() ?? null, suppliedPoll.error ? 0 : rate);
  const balance: Read<bigint> = accrued !== null ? { kind: "ok", value: accrued } : supplied;
  const trustline: Read<boolean> = walletPoll.value !== null ? { kind: "ok", value: walletPoll.value >= 0n } : pending(walletPoll);
  const wallet: Read<bigint> =
    walletPoll.value !== null ? { kind: "ok", value: walletPoll.value < 0n ? 0n : walletPoll.value } : pending(walletPoll);

  const [flow, emit] = useFlow();
  const [action, setAction] = useState<FundsSide | null>(null);
  const [lastAmount, setLastAmount] = useState<bigint | null>(null);
  const submit = useCallback(
    (side: FundsSide, amountStroops: bigint) => {
      if (!address) return;
      setAction(side);
      setLastAmount(amountStroops);
      emit({ type: "start" });
      const out = suppliedPoll.value !== null ? withdrawable(suppliedPoll.value, poolPoll.value?.available ?? null) : null;
      const all = side === "out" && out !== null && !out.limitedByPool && amountStroops === out.stroops;
      const run = side === "in" ? supply : (p: Parameters<typeof withdraw>[0]) => withdraw({ ...p, all });
      const origin = currentRoute();
      const link = { href: origin, label: "Open Lend" };
      const amount = formatUsdc(amountStroops);
      void locks()
        .withTxLock(address, () => run({ amountStroops, supplier: address, signTransaction: w.signTransaction, emit }))
        .then(({ txHash }) => {
          if (txHash) {
            recentActivity.add(address, {
              hash: txHash,
              chain: "stellar",
              label: side === "in" ? "Supplied to the pool" : "Withdrawn from the pool",
              at: Date.now(),
            });
            notifySettled(origin, link, {
              ok: true,
              text: side === "in" ? `Supplied ${amount} USDC to the pool.` : `Withdrawn ${amount} USDC from the pool. It's in your wallet.`,
            });
          }
        })
        .catch((error: unknown) => {
          emit({ type: "failed", error });
          notifySettled(origin, link, { ok: false, error, what: `Your ${side === "in" ? "supply" : "withdrawal"} of ${amount} USDC` });
        })
        .finally(refresh);
    },
    [address, w.signTransaction, emit, refresh, suppliedPoll.value, poolPoll.value],
  );

  const [trustBusy, setTrustBusy] = useState(false);
  const [trustError, setTrustError] = useState<unknown>(null);
  const addTrust = useCallback(() => {
    if (!address) return;
    setTrustBusy(true);
    setTrustError(null);
    locks()
      .withTxLock(address, () => enableTrustline({ address, asset: POOL_ASSET, signTransaction: w.signTransaction }))
      .then(refresh)
      .catch((e: unknown) => setTrustError(e))
      .finally(() => setTrustBusy(false));
  }, [address, w.signTransaction, refresh]);

  const funding = a.stellar.funding;
  return {
    connected: Boolean(address),
    connecting: a.stellar.connecting,
    connect: a.stellar.connect,
    walletName: a.stellar.walletName,
    wrongNetwork: a.stellar.wrongNetwork,
    unfunded: funding.kind === "ok" && funding.value.kind === "unfunded",
    pool,
    supplied,
    balance,
    stale:
      suppliedPoll.error && suppliedPoll.value !== null && poolPoll.value && suppliedPoll.updatedAt
        ? { supplied: suppliedPoll.value, pool: poolPoll.value, at: suppliedPoll.updatedAt.getTime() }
        : null,
    retry: refresh,
    funds: address
      ? {
          unit: "USDC",
          walletName: a.stellar.walletName,
          sides: lendSides(wallet, supplied, pool),
          defaultSide: "in",
          trustline,
          trust: {
            text: "Add USDC to your Stellar wallet. One signature. Your wallet sets aside 0.5 XLM.",
            button: "Add USDC",
            busy: trustBusy,
            error: trustError,
            add: addTrust,
          },
          flow,
          action,
          lastAmount,
          otherTx: a.otherTabTx,
          submit,
          dismiss: () => emit({ type: "reset" }),
          checkAgain: refresh,
        }
      : null,
  };
}
