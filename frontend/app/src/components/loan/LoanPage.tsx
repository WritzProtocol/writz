"use client";

import { StatusProvider } from "@/lib/status/provider";
import type { LoanTab } from "@/lib/loan/model";
import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/redesign/hooks";
import { LoanView } from "./LoanView";
import { useLiveLoan } from "./useLiveLoan";
import { useMockLoan } from "./useMockLoan";

function LiveLoan({ n, panel }: { n: number; panel: LoanTab | null }) {
  return <LoanView m={useLiveLoan(n, panel)} />;
}

function MockLoan({ world, n }: { world: MockWorld; n: number }) {
  return <LoanView m={useMockLoan(world, n)} />;
}

/** Static placeholder at the real size of the page while the client hydrates. */
function Skeleton() {
  return (
    <div className="ln-col" aria-hidden="true">
      <div className="wz-skeleton" style={{ height: 40, width: 180 }} />
      <div className="wz-skeleton" style={{ height: 210, borderRadius: 14 }} />
      <div className="wz-skeleton" style={{ height: 52, borderRadius: 10 }} />
      <div className="wz-skeleton" style={{ height: 260, borderRadius: 14 }} />
    </div>
  );
}

export function LoanPage({ n, panel }: { n: number; panel: LoanTab | null }) {
  const mounted = useMounted();
  const world = useMockWorld();
  if (!mounted) return <Skeleton />;
  return <StatusProvider>{world ? <MockLoan world={world} n={n} /> : <LiveLoan n={n} panel={panel} />}</StatusProvider>;
}
