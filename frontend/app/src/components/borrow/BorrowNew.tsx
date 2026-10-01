"use client";

import { StatusProvider } from "@/lib/status/provider";
import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/redesign/hooks";
import { FocusJourney } from "./FocusJourney";
import { useLiveJourney } from "./useLiveJourney";
import { useMockJourney } from "./useMockJourney";

function LiveJourney() {
  return <FocusJourney m={useLiveJourney()} />;
}

function MockJourney({ world }: { world: MockWorld }) {
  return <FocusJourney m={useMockJourney(world)} />;
}

/** Static placeholder at the real size of the first screen while the client hydrates. */
function Skeleton() {
  return (
    <div className="fo-col" aria-hidden="true">
      <div className="fo-progress">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <div className="fo-meta" />
      <section className="fo-card">
        <div className="wz-skeleton" style={{ height: 36, width: "70%" }} />
        <div className="wz-skeleton" style={{ height: 64, marginTop: 24 }} />
        <div className="wz-skeleton" style={{ height: 140, marginTop: 16 }} />
      </section>
    </div>
  );
}

export function BorrowNew() {
  const mounted = useMounted();
  const world = useMockWorld();
  if (!mounted) return <Skeleton />;
  return <StatusProvider>{world ? <MockJourney world={world} /> : <LiveJourney />}</StatusProvider>;
}
