"use client";

import { useState } from "react";
import { DepositFlow } from "./DepositFlow";
import { PositionDashboard } from "./PositionDashboard";
import { LenderPanel } from "./LenderPanel";

type Tab = "borrow" | "lend";

/**
 * Separates the two distinct user journeys so neither has to scroll past the
 * other's UI: Borrow (deposit BTC + manage positions) and Lend (supply USDC).
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
        </div>
        <p className="text-sm text-muted">
          {tab === "borrow"
            ? "Lock BTC as collateral and borrow USDC privately — no bridge, no custodian."
            : "Supply USDC to the pool and earn from borrower demand."}
        </p>
      </div>

      {tab === "borrow" ? (
        <div className="flex flex-col gap-12">
          <DepositFlow />
          <PositionDashboard />
        </div>
      ) : (
        <LenderPanel />
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
