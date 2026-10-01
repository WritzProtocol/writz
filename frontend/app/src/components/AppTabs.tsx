"use client";

import { useState } from "react";
import { DepositFlow } from "./DepositFlow";
import { PositionDashboard } from "./PositionDashboard";
import { LenderPanel } from "./LenderPanel";
import { EarnPanel } from "./EarnPanel";

type Tab = "borrow" | "lend" | "earn";

const BLURBS: Record<Tab, string> = {
  borrow: "Lock BTC on Bitcoin and borrow up to two thirds of its value in USDC. No bridge, no wrapped token.",
  lend: "Supply USDC to the pool borrowers draw from. The pool pays no interest yet on Stellar testnet. You withdraw what you supplied.",
  earn: "Deposit Blend test USDC into the Writz vault on DeFindex. It earns from Blend lending. Shares sit in your own wallet.",
};

/**
 * Separates the distinct user journeys so none has to scroll past another's
 * UI: Borrow (deposit BTC + manage positions), Lend (supply USDC to the Writz
 * pool), and Earn (deposit USDC into the DeFindex vault).
 */
export function AppTabs() {
  const [tab, setTab] = useState<Tab>("borrow");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div
          role="tablist"
          aria-label="Choose flow"
          className="inline-flex self-start rounded-full border border-line bg-surface p-1"
        >
          <TabButton id="borrow" active={tab === "borrow"} onSelect={setTab}>
            Borrow
          </TabButton>
          <TabButton id="lend" active={tab === "lend"} onSelect={setTab}>
            Lend
          </TabButton>
          <TabButton id="earn" active={tab === "earn"} onSelect={setTab}>
            Earn
          </TabButton>
        </div>
        <p className="text-sm text-muted">{BLURBS[tab]}</p>
      </div>

      {tab === "borrow" ? (
        <div className="flex flex-col gap-12">
          <DepositFlow />
          <PositionDashboard />
        </div>
      ) : tab === "lend" ? (
        <LenderPanel />
      ) : (
        <EarnPanel />
      )}
    </div>
  );
}

function TabButton({
  id,
  active,
  onSelect,
  children,
}: {
  id: Tab;
  active: boolean;
  onSelect: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(id)}
      className={`rounded-full px-6 py-1.5 text-sm font-semibold transition-colors ${
        active ? "bg-amber text-[#1a1206]" : "text-muted hover:text-head"
      }`}
    >
      {children}
    </button>
  );
}
