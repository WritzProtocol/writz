import type { Metadata } from "next";
import "../home.css";
import { LenderPanel } from "@/components/LenderPanel";

export const metadata: Metadata = {
  title: "Lend USDC | Writz",
  alternates: { canonical: "/lend" },
};

export default function LendPage() {
  return (
    <div className="hm-legacy">
      <h1 className="hm-h1">Lend</h1>
      <p className="hm-sub">
        Supply USDC to the pool borrowers draw from. The pool pays no interest yet on Stellar testnet. You withdraw what you
        supplied.
      </p>
      <LenderPanel />
    </div>
  );
}
