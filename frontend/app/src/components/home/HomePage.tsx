"use client";

import { useState } from "react";
import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/ui/hooks";
import { useShellAccount } from "@/components/shell/account";
import { mockHomeData, useLiveHomeData } from "./data";
import { HomeView } from "./HomeView";
import { HowSkeleton, LoanSkeleton, PreviewSkeleton } from "./parts";
import { T } from "@/components/ui/skeleton";

function LiveHome() {
  const a = useShellAccount();
  return <HomeView data={useLiveHomeData(a.stellar.address)} />;
}

function MockHome({ world }: { world: MockWorld }) {
  const [now] = useState(() => Date.now());
  return <HomeView data={mockHomeData(world, now)} />;
}

function Foot() {
  return (
    <nav className="hm-foot">
      {["Protocol stats", "How to reclaim", "Docs"].map((t) => (
        <span key={t} className="wz-btn wz-btn-text">
          <T>{t}</T>
        </span>
      ))}
    </nav>
  );
}

/** The page at its loaded layout until the client knows the wallet: the loan panel when this browser has loans, the first-visit page otherwise. */
function Skeleton() {
  return (
    <>
      <h1 className="wz-sr">Loading Writz</h1>
      <div className="hm-col" aria-hidden="true" data-sk="loans">
        <div className="hm-head">
          <p className="hm-h1 hm-display">
            <T>Your loan is healthy.</T>
          </p>
        </div>
        <div className="hm-loans" data-count="1">
          <LoanSkeleton />
        </div>
        <Foot />
      </div>
      <div className="hm-col" aria-hidden="true" data-sk="noloans">
        <div className="hm-head">
          <p className="hm-h1 hm-display">
            <T>Lock Bitcoin. Borrow dollars.</T>
          </p>
          <p className="hm-sub">
            <T>
              Lock BTC on Bitcoin and borrow USDC on Stellar. Repay and your BTC comes back. No bridge, no custodian, no wrapped token.
              Test funds only.
            </T>
          </p>
        </div>
        <PreviewSkeleton />
        <HowSkeleton />
        <Foot />
      </div>
    </>
  );
}

export function HomePage() {
  const mounted = useMounted();
  const world = useMockWorld();
  const a = useShellAccount();
  if (!mounted || !a.walletsKnown) return <Skeleton />;
  return world ? <MockHome world={world} /> : <LiveHome />;
}
