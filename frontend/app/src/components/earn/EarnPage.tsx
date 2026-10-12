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
    <div className="fu-col">
      <h1 className="hm-h1">Earn on USDC</h1>
      <div className="wz-skeleton" aria-hidden="true" style={{ height: 120, borderRadius: 14 }} />
      <div className="wz-skeleton" aria-hidden="true" style={{ height: 260, borderRadius: 14 }} />
    </div>
  );
}

export function EarnPage() {
  const mounted = useMounted();
  const world = useMockWorld();
  if (!mounted) return <Skeleton />;
  return world ? <MockEarn world={world} /> : <LiveEarn />;
}
