"use client";

import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/ui/hooks";
import { useShellAccount } from "@/components/shell/account";
import { FundsSkeleton } from "@/components/funds/Skeleton";
import { EarnView } from "./EarnView";
import { useLiveEarn } from "./useLiveEarn";
import { useMockEarn } from "./useMockEarn";

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
      lede="Deposit Blend test USDC into the Writz vault on DeFindex. It earns from Blend lending. Shares sit in your own wallet."
      wallet={{
        hero: { label: "Your balance", value: "1,003.41", unit: "USDC (Blend)" },
        tiles: [
          ["Earned so far", "3.41 USDC (Blend)"],
          ["APY", "7.31%", "Earned from Blend lending. Changes over time. Updated 05:21."],
        ],
      }}
      nowallet={{ tiles: [["APY", "7.31%", "Earned from Blend lending. Changes over time. Updated 05:21."]] }}
      risk={["Blend test USDC is a different asset from the USDC you borrow.", "The vault carries Blend's lending risk."]}
      link="See vault stats"
      tabs={["Deposit", "Withdraw"]}
      field="Deposit USDC (Blend)"
      hint="Wallet: 1,240.50 USDC (Blend)."
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
