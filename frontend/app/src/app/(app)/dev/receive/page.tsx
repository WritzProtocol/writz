import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UI_MOCK } from "@/lib/mock/gate";
import { ReceiveStates } from "./ReceiveStates";
import "../scenarios/dev.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Receive states | Writz",
  robots: { index: false, follow: false },
};

export default function DevReceive() {
  if (!UI_MOCK) notFound();
  return (
    <div className="dv">
      <header className="dv-head">
        <h1>Receive states</h1>
        <p>Step 2 of a borrow in every state: convert to XLM or send to another chain after the USDC is in the wallet.</p>
      </header>
      <ReceiveStates />
    </div>
  );
}
