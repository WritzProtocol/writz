import type { Metadata } from "next";
import { EarnPage } from "@/components/earn/EarnPage";
import { EARN_COPY } from "@/components/earn/copy";
import "../funds.css";

export const metadata: Metadata = {
  title: `${EARN_COPY.title} | Writz`,
  alternates: { canonical: "/earn" },
};

export default function Earn() {
  return <EarnPage />;
}
