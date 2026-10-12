import type { Metadata } from "next";
import "../home.css";
import { EarnPanel } from "@/components/EarnPanel";

export const metadata: Metadata = {
  title: "Earn on USDC | Writz",
  alternates: { canonical: "/earn" },
};

export default function EarnPage() {
  return (
    <div className="hm-legacy">
      <h1 className="hm-h1">Earn</h1>
      <p className="hm-sub">
        Deposit Blend test USDC into the Writz vault on DeFindex. It earns from Blend lending. Shares sit in your own wallet.
      </p>
      <EarnPanel />
    </div>
  );
}
