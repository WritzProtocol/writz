"use client";

import { useState } from "react";
import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/redesign/hooks";
import { useShellAccount } from "@/components/shell/account";
import { mockHomeData, useLiveHomeData } from "./data";
import { HomeView } from "./HomeView";

function LiveHome() {
  const a = useShellAccount();
  return <HomeView data={useLiveHomeData(a.stellar.address)} />;
}

function MockHome({ world }: { world: MockWorld }) {
  const [now] = useState(() => Date.now());
  return <HomeView data={mockHomeData(world, now)} />;
}

/** Static placeholder at the real size of the first screen while the client hydrates. */
function Skeleton() {
  return (
    <div className="hm-col">
      <h1 className="wz-sr">Loading Writz</h1>
      <div className="wz-skeleton" aria-hidden="true" style={{ height: 44, width: "min(520px, 80%)" }} />
      <div className="wz-skeleton" aria-hidden="true" style={{ height: 22, width: "min(640px, 95%)" }} />
      <div className="hm-preview" aria-hidden="true">
        <div className="wz-skeleton" style={{ height: 300, borderRadius: 14 }} />
        <div className="wz-skeleton" style={{ height: 200, borderRadius: 14 }} />
      </div>
    </div>
  );
}

export function HomePage() {
  const mounted = useMounted();
  const world = useMockWorld();
  if (!mounted || world?.globals.hydrating) return <Skeleton />;
  return world ? <MockHome world={world} /> : <LiveHome />;
}
