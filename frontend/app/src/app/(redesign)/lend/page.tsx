import type { Metadata } from "next";
import { LendPage } from "@/components/lend/LendPage";
import "../home.css";
import "../loans/loans.css";
import "../funds.css";

export const metadata: Metadata = {
  title: "Lend USDC | Writz",
  alternates: { canonical: "/lend" },
};

export default function Lend() {
  return <LendPage />;
}
