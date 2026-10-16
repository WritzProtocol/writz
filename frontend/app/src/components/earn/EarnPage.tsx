"use client";

import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/redesign/hooks";
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
    <div className="fu-page">
      <header>
        <h1 className="fu-h1">Earn on USDC</h1>
      </header>
      <div className="fu-grid" aria-hidden="true">
        <div className="wz-skeleton fu-sk-hero" />
        <div className="wz-skeleton fu-sk-act" />
      </div>
    </div>
  );
}

export function EarnPage() {
  const mounted = useMounted();
  const world = useMockWorld();
  if (!mounted) return <Skeleton />;
  return world ? <MockEarn world={world} /> : <LiveEarn />;
}
