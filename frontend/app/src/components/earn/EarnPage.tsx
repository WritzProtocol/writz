"use client";

import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/ui/hooks";
import { useShellAccount } from "@/components/shell/account";
import { FundsSkeleton } from "@/components/funds/Skeleton";
import { EarnView } from "./EarnView";
import { useLiveEarn } from "./useLiveEarn";
import { useMockEarn } from "./useMockEarn";
import { EARN_COPY } from "./copy";

function LiveEarn() {
  return <EarnView m={useLiveEarn()} />;
}

function MockEarn({ world }: { world: MockWorld }) {
  return <EarnView m={useMockEarn(world)} />;
}

function Skeleton() {
  return (
    <FundsSkeleton
      title="Earn on USDC"
      lede={EARN_COPY.lede}
      wallet={{
        hero: { label: "Your balance", value: "1,003.41", unit: EARN_COPY.unit },
        tiles: [
          ["Earned so far", `3.41 ${EARN_COPY.unit}`],
          ["APY", "7.31%", "Earned from Blend lending. Changes over time. Updated 05:21."],
        ],
      }}
      nowallet={{ tiles: [["APY", "7.31%", "Earned from Blend lending. Changes over time. Updated 05:21."]] }}
      risk={EARN_COPY.risk}
      link="See vault stats"
      tabs={["Deposit", "Withdraw"]}
      field={`Deposit ${EARN_COPY.unit}`}
      hint={`Wallet: 1,240.50 ${EARN_COPY.unit}.`}
      connect="Connect a Stellar wallet to see your balance."
    />
  );
}

export function EarnPage() {
  const mounted = useMounted();
  const world = useMockWorld();
  const a = useShellAccount();
  if (!mounted || !a.walletsKnown) return <Skeleton />;
  return world ? <MockEarn world={world} /> : <LiveEarn />;
}
