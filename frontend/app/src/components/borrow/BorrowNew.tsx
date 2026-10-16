"use client";

import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/ui/hooks";
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
    <div className="bj" aria-hidden="true">
      <div className="bj-progress">
        {Array.from({ length: 6 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <div className="bj-stepline" />
      <div className="wz-skeleton" style={{ height: 64, width: "70%", marginTop: 56 }} />
      <div className="bj-grid">
        <div className="bj-col">
          <div className="wz-skeleton" style={{ height: 320 }} />
        </div>
      </div>
    </div>
  );
}

export function BorrowNew() {
  const mounted = useMounted();
  const world = useMockWorld();
  if (!mounted) return <Skeleton />;
  return world ? <MockJourney world={world} /> : <LiveJourney />;
}
