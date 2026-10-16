"use client";

import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/ui/hooks";
import { useShellAccount } from "@/components/shell/account";
import { FundsSkeleton } from "@/components/funds/Skeleton";
import { LendView } from "./LendView";
import { useLiveLend } from "./useLiveLend";
import { useMockLend } from "./useMockLend";

function LiveLend() {
  return <LendView m={useLiveLend()} />;
}

function MockLend({ world }: { world: MockWorld }) {
  return <LendView m={useMockLend(world)} />;
}

function Skeleton() {
  return (
    <FundsSkeleton
      title="Lend USDC"
      lede="Supply USDC to the pool borrowers draw from. You can withdraw what you supplied."
      wallet={{
        hero: { label: "You supplied", value: "2,500.00", unit: "USDC" },
        tiles: [
          ["Available in pool", "122,820.00 USDC"],
          ["You can withdraw now", "2,500.00 USDC"],
        ],
      }}
      nowallet={{ hero: { label: "Available in pool", value: "122,820.00", unit: "USDC" }, tiles: [["Supplied by lenders", "184,250.00 USDC"]] }}
      risk={["Suppliers carry Bitcoin credit risk. When borrowers are using the pool, you may have to wait to withdraw."]}
      link="See pool stats"
      tabs={["Supply", "Withdraw"]}
      field="Supply USDC"
      hint="Wallet: 1,240.00 USDC."
      connect="Connect your Stellar wallet to lend USDC."
    />
  );
}

export function LendPage() {
  const mounted = useMounted();
  const world = useMockWorld();
  const a = useShellAccount();
  if (!mounted || !a.walletsKnown) return <Skeleton />;
  return world ? <MockLend world={world} /> : <LiveLend />;
}
