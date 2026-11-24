"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { EarnView } from "@/components/earn/EarnView";
import { useMockEarn } from "@/components/earn/useMockEarn";
import { getScenario } from "@/lib/mock/scenarios";
import type { MockWorld } from "@/lib/mock/types";
import { ReviewsContext } from "@/lib/wallet/reviewsContext";
import { SigningReviews, type ReviewMode, type ReviewRequest } from "@/lib/wallet/signingReview";
import * as ui from "@/components/ui/styles";
import * as dv from "../styles";

/** What the check shows for a Pollar deposit into Earn, in each of its three states. */
const REQUESTS: Record<ReviewMode, { title: string; request: ReviewRequest }> = {
  mismatch: {
    title: "Stopped: not what was asked",
    request: {
      mode: "mismatch",
      asked: "Deposit 10.00 USDC into the Earn vault",
      actual: ["Send 500.00 USDC (Blend) to GDQP…4W37"],
      detail: "wrong_contract: calls a contract other than the Earn vault",
      limit: null,
      walletName: "Pollar",
    },
  },
  unknown: {
    title: "Can't check: no known purpose",
    request: {
      mode: "unknown",
      asked: null,
      actual: ["Call claim_rewards on contract CDLZ…CYSC", "and approve other contract calls in your name"],
      detail: "no intent declared",
      limit: null,
      walletName: "Pollar",
    },
  },
  large: {
    title: "Large amount: confirm",
    request: {
      mode: "large",
      asked: "Deposit 25,000.00 USDC into the Earn vault",
      actual: ["Deposit into the Earn vault"],
      detail: null,
      limit: 10_000_0000000n,
      walletName: "Pollar",
    },
  },
};

const MODES: ReviewMode[] = ["mismatch", "unknown", "large"];

function earnWorld(): MockWorld {
  const world = getScenario("E6")!.build(Date.now());
  return { ...world, flow: { kind: "earn_deposit", lifecycle: "awaiting_signature", state: { phase: "awaiting_signature", wallet: "stellar" } } } as MockWorld;
}

function Preview({ mode }: { mode: ReviewMode }) {
  const [world] = useState(earnWorld);
  const [reviews] = useState(() => {
    const r = new SigningReviews();
    void r.request(REQUESTS[mode].request).then(() => {
      // Answered: show it again, so the state stays on screen.
      setTimeout(() => void r.request(REQUESTS[mode].request), 600);
    });
    return r;
  });
  const m = useMockEarn(world);
  return (
    <ReviewsContext.Provider value={reviews}>
      <EarnView m={{ ...m, funds: m.funds ? { ...m.funds, walletName: "Pollar" } : null }} />
    </ReviewsContext.Provider>
  );
}

export function SigningStates() {
  const params = useSearchParams();
  const asked = params.get("state");
  const mode: ReviewMode = MODES.includes(asked as ReviewMode) ? (asked as ReviewMode) : "mismatch";
  return (
    <div className={dv.page}>
      <header className={dv.head}>
        <h1>Signing check</h1>
        <p>What a Pollar user sees in the action&apos;s own panel when a transaction is not what they asked for, has no known purpose, or is above the large-amount limit.</p>
        <nav className={dv.areas} aria-label="States">
          {MODES.map((m) => (
            <Link key={m} href={`/dev/signing?state=${m}`} className={ui.chip} aria-current={m === mode ? "page" : undefined}>
              {REQUESTS[m].title}
            </Link>
          ))}
        </nav>
      </header>
      <Preview key={mode} mode={mode} />
    </div>
  );
}
