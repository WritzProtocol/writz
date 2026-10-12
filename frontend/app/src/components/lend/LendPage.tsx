"use client";

import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/redesign/hooks";
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
    <div className="fu-col">
      <h1 className="hm-h1">Lend USDC</h1>
      <div className="wz-skeleton" aria-hidden="true" style={{ height: 120, borderRadius: 14 }} />
      <div className="wz-skeleton" aria-hidden="true" style={{ height: 260, borderRadius: 14 }} />
    </div>
  );
}

export function LendPage() {
  const mounted = useMounted();
  const world = useMockWorld();
  if (!mounted) return <Skeleton />;
  return world ? <MockLend world={world} /> : <LiveLend />;
}
