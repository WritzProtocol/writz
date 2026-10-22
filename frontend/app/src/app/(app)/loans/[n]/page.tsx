import type { Metadata } from "next";
import Link from "next/link";
import { LoanPage } from "@/components/loan/LoanPage";
import { parseLoanNumber, parsePanel } from "@/lib/loan/model";
import "../loans.css";

type Props = {
  params: Promise<{ n: string }>;
  searchParams: Promise<{ panel?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = parseLoanNumber((await params).n);
  return { title: n ? `Loan ${n} | Writz` : "Loan | Writz" };
}

export default async function LoanRoute({ params, searchParams }: Props) {
  const n = parseLoanNumber((await params).n);
  const raw = (await searchParams).panel;
  const panel = parsePanel(Array.isArray(raw) ? raw[0] : raw);
  if (!n)
    return (
      <div className="ln-col">
        <header className="ln-head">
          <h1>Loan not found</h1>
        </header>
        <section className="ln-empty">
          <p>There is no loan with that number on this device.</p>
          <Link href="/" className="wz-btn wz-btn-gold">
            Go home
          </Link>
        </section>
      </div>
    );
  return <LoanPage n={n} panel={panel} />;
}
