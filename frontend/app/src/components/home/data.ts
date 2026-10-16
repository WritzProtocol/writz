"use client";

import { useState } from "react";
import { config } from "@/config";
import { fetchTipHeight } from "@/lib/bitcoin/timelock";
import { getSupplyBalance } from "@/lib/contracts/commitmentTree";
import { earnApi } from "@/lib/earn/api";
import type { Read } from "@/lib/loan/model";
import type { MockWorld, Reading } from "@/lib/mock/types";
import { defaultStatusSource } from "@/lib/status/provider";
import { useRead } from "@/components/ui/hooks";

export interface EarnSummary {
  balanceStroops: bigint;
  earnedStroops: bigint | null;
  apy: number | null;
}

export interface HomeData {
  now: number;
  price: Read<bigint>;
  tipHeight: number | null;
  earn: Read<EarnSummary> | null;
  lend: Read<bigint> | null;
  retry(): void;
}

export function useLiveHomeData(address: string | null): HomeData {
  const [now] = useState(() => Date.now());
  const [nonce, setNonce] = useState(0);
  const price = useRead(`price:${nonce}`, () => defaultStatusSource().getOraclePrice());
  const tip = useRead(`tip:${nonce}`, () => fetchTipHeight(config.bitcoin.apiUrl));
  const earn = useRead(address ? `earn:${address}:${nonce}` : null, async (): Promise<EarnSummary> => {
    const [position, apy] = await Promise.all([earnApi().getPosition(address!), earnApi().getApy().catch(() => null)]);
    return { balanceStroops: position.underlyingStroops, earnedStroops: null, apy };
  });
  const lend = useRead(address ? `lend:${address}:${nonce}` : null, () => getSupplyBalance(address!));
  return {
    now,
    price,
    tipHeight: tip.kind === "ok" ? tip.value : null,
    earn: address ? earn : null,
    lend: address ? lend : null,
    retry: () => setNonce((n) => n + 1),
  };
}

const read = <T,>(r: Reading<T> | undefined): Read<T> =>
  !r || r.state === "loading" ? { kind: "checking" } : r.state === "failed" ? { kind: "failed" } : { kind: "ok", value: r.value };

const noop = () => {};

export function mockHomeData(world: MockWorld, now: number): HomeData {
  const sw = world.wallets.stellar;
  const e = world.earn;
  const vault = read(e?.vaultStroops);
  const earned = read(e?.earnedStroops);
  const apy = read(e?.apy);
  return {
    now,
    price: world.chain.oraclePriceStroops === undefined ? { kind: "failed" } : { kind: "ok", value: world.chain.oraclePriceStroops },
    tipHeight: world.chain.btcTipHeight ?? null,
    earn: !sw
      ? null
      : !e
        ? { kind: "ok", value: { balanceStroops: 0n, earnedStroops: null, apy: null } }
        : vault.kind === "ok"
          ? {
              kind: "ok",
              value: {
                balanceStroops: vault.value,
                earnedStroops: earned.kind === "ok" ? earned.value : null,
                apy: apy.kind === "ok" ? apy.value : null,
              },
            }
          : vault,
    lend: !sw ? null : world.lend ? read(world.lend.suppliedStroops) : { kind: "ok", value: 0n },
    retry: noop,
  };
}
