"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { earnApi } from "@/lib/earn/api";
import { usePolledValue } from "@/lib/earn/usePolledValue";
import { depositToVault, withdrawFromVault } from "@/lib/flows/earn";
import { EARN_ASSET, enableTrustline, getAssetBalance } from "@/lib/flows/trustline";
import { useFlow } from "@/lib/flow/useFlow";
import { locks } from "@/lib/flow/lock";
import type { FundsSide } from "@/lib/funds/model";
import type { Read } from "@/lib/loan/model";
import { recentActivity } from "@/lib/tray";
import { useShellAccount } from "@/components/shell/account";
import { earnSides, UNIT, type EarnModel } from "./model";

const POSITION_POLL_MS = 15_000;
const APY_POLL_MS = 60_000;

/** For a poll with no value yet. */
const pending = (p: { loading: boolean }): Read<never> => (p.loading ? { kind: "checking" } : { kind: "failed" });

export function useLiveEarn(): EarnModel {
  const a = useShellAccount();
  const w = useWallet();
  const address = a.stellar.address;
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const readApy = useCallback(() => earnApi().getApy(), []);
  const readPosition = useCallback((key: string) => earnApi().getPosition(key.split(":")[0]!), []);
  const readWallet = useCallback(async (key: string) => (await getAssetBalance(key.split(":")[0]!, EARN_ASSET)) ?? -1n, []);

  const apy = usePolledValue("vault", readApy, APY_POLL_MS);
  const position = usePolledValue(address ? `${address}:${nonce}` : null, readPosition, POSITION_POLL_MS);
  const walletRaw = usePolledValue(address ? `${address}:${nonce}` : null, readWallet, POSITION_POLL_MS);

  // -1 marks "no trustline" so one read answers both questions.
  const trustline: Read<boolean> = walletRaw.value !== null ? { kind: "ok", value: walletRaw.value >= 0n } : pending(walletRaw);
  const wallet: Read<bigint> =
    walletRaw.value !== null ? { kind: "ok", value: walletRaw.value < 0n ? 0n : walletRaw.value } : pending(walletRaw);
  const balance: Read<bigint> =
    position.error && position.value ? { kind: "failed" } : position.value ? { kind: "ok", value: position.value.underlyingStroops } : pending(position);

  const [flow, emit] = useFlow();
  const [action, setAction] = useState<FundsSide | null>(null);
  const [lastAmount, setLastAmount] = useState<bigint | null>(null);
  const submit = useCallback(
    (side: FundsSide, amountStroops: bigint) => {
      if (!address) return;
      setAction(side);
      setLastAmount(amountStroops);
      emit({ type: "start" });
      const run = side === "in" ? depositToVault : withdrawFromVault;
      void locks()
        .withTxLock(address, () => run({ amountStroops, caller: address, signTransaction: w.signTransaction, emit }))
        .then(({ txHash }) =>
          recentActivity.add(address, {
            hash: txHash,
            chain: "stellar",
            label: side === "in" ? `Deposited to Earn` : `Withdrawn from Earn`,
            at: Date.now(),
          }),
        )
        .catch((error: unknown) => emit({ type: "failed", error }))
        .finally(refresh);
    },
    [address, w.signTransaction, emit, refresh],
  );

  const [trustBusy, setTrustBusy] = useState(false);
  const [trustError, setTrustError] = useState<unknown>(null);
  const addTrust = useCallback(() => {
    if (!address) return;
    setTrustBusy(true);
    setTrustError(null);
    locks()
      .withTxLock(address, () => enableTrustline({ address, asset: EARN_ASSET, signTransaction: w.signTransaction }))
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
    apy: { value: apy.value, at: apy.updatedAt?.getTime() ?? null, failed: apy.value === null && !apy.loading },
    balance,
    earned: null,
    stale: position.error && position.value && position.updatedAt ? { value: position.value.underlyingStroops, at: position.updatedAt.getTime() } : null,
    retry: () => void position.refresh(),
    wallet,
    paused: false,
    funds: address
      ? {
          unit: UNIT,
          walletName: a.stellar.walletName,
          sides: earnSides(wallet, balance, false),
          defaultSide: "in",
          trustline,
          trust: {
            text: `Add ${UNIT} to your wallet. One signature. Your wallet sets aside 0.5 XLM.`,
            button: `Add ${UNIT}`,
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
