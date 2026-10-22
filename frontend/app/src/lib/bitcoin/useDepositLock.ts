"use client";

import { useEffect, useMemo, useState } from "react";
import { config } from "@/config";
import { deriveP2WSH } from "./address";
import { chooseDepositTimelock, fetchTipHeight } from "./timelock";
import type { DepositLock } from "@/lib/flows/deposit";

export type DepositLockState =
  | { kind: "unavailable" }
  | { kind: "loading" }
  | { kind: "failed"; error: unknown; retry: () => void }
  | { kind: "ready"; lock: DepositLock; tipHeight: number };

/**
 * The lock address for a new deposit by `btcPubkey`. The timelock is chosen
 * once from the live tip and kept for the page's life, so the address shown
 * is the address the wallet pays.
 */
export function useDepositLock(btcPubkey: string | null | undefined): DepositLockState {
  const [tip, setTip] = useState<{ height: number } | { error: unknown } | null>(null);
  const protocolPubkey = config.bitcoin.protocolPubkey;

  useEffect(() => {
    if (!protocolPubkey || !btcPubkey || tip) return;
    let live = true;
    fetchTipHeight(config.bitcoin.apiUrl)
      .then((height) => live && setTip({ height }))
      .catch((error: unknown) => live && setTip({ error }));
    return () => {
      live = false;
    };
  }, [protocolPubkey, btcPubkey, tip]);

  return useMemo<DepositLockState>(() => {
    if (!protocolPubkey || !btcPubkey) return { kind: "unavailable" };
    if (!tip) return { kind: "loading" };
    if ("error" in tip) {
      return {
        kind: "failed",
        error: tip.error,
        retry: () => setTip(null),
      };
    }
    const timelockHeight = chooseDepositTimelock(tip.height);
    try {
      const { address } = deriveP2WSH(protocolPubkey, btcPubkey, timelockHeight);
      return { kind: "ready", lock: { p2wsh: address, timelockHeight }, tipHeight: tip.height };
    } catch (error) {
      return { kind: "failed", error, retry: () => setTip(null) };
    }
  }, [protocolPubkey, btcPubkey, tip]);
}
