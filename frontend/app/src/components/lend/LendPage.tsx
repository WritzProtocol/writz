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
    <div className="fu-page">
      <header>
        <h1 className="fu-h1">Lend USDC</h1>
      </header>
      <div className="fu-grid" aria-hidden="true">
        <div className="wz-skeleton fu-sk-hero" />
        <div className="wz-skeleton fu-sk-act" />
      </div>
    </div>
  );
}

export function LendPage() {
  const mounted = useMounted();
  const world = useMockWorld();
  if (!mounted) return <Skeleton />;
  return world ? <MockLend world={world} /> : <LiveLend />;
}
