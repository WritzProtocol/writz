import type { Metadata } from "next";
import { LendPage } from "@/components/lend/LendPage";
import "../funds.css";

export const metadata: Metadata = {
  title: "Lend USDC | Writz",
  alternates: { canonical: "/lend" },
};

export default function Lend() {
  return <LendPage />;
}
