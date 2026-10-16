import type { Metadata } from "next";
import { EarnPage } from "@/components/earn/EarnPage";
import "../funds.css";

export const metadata: Metadata = {
  title: "Earn on USDC | Writz",
  alternates: { canonical: "/earn" },
};

export default function Earn() {
  return <EarnPage />;
}
