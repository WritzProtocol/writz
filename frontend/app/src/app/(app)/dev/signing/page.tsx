import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UI_MOCK } from "@/lib/mock/gate";
import { SigningStates } from "./SigningStates";
import "../../funds.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Signing check states | Writz",
  robots: { index: false, follow: false },
};

export default function DevSigning() {
  if (!UI_MOCK) notFound();
  return <SigningStates />;
}
