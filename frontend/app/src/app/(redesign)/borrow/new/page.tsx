import type { Metadata } from "next";
import { BorrowNew } from "@/components/borrow/BorrowNew";

export const metadata: Metadata = {
  title: "Borrow against your BTC | Writz",
  alternates: { canonical: "/borrow/new" },
};

export default function BorrowNewPage() {
  return <BorrowNew />;
}
