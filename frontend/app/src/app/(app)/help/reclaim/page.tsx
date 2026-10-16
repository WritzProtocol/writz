import type { Metadata } from "next";
import { RECLAIM_DOCS_URL } from "@/lib/links";
import { ExternalLink } from "@/components/ui";
import { ReclaimLoans } from "@/components/reclaim/ReclaimLoans";
import "../../funds.css";
import "../../reclaim.css";

export const metadata: Metadata = {
  title: "Reclaim your BTC without Writz | Writz",
  alternates: { canonical: "/help/reclaim" },
};

const STEPS = [
  ["Wait for the timelock", "Bitcoin has to reach your loan's timelock block. Before that, the network rejects the reclaim."],
  ["Gather the details", "Take the deposit's details from your loan backup and have your Bitcoin key ready."],
  ["Build and sign", "Use the reference script from the docs with your key. Don't build it by hand in a generic wallet: one wrong setting gets it rejected."],
  ["Broadcast and check", "Send the signed transaction and follow it on mempool until it confirms."],
] as const;

export default function ReclaimHelp() {
  return (
    <article className="rc-page">
      <header>
        <h1 className="rc-h1">How to reclaim your BTC without Writz</h1>
        <p className="fu-lede">
          For when Writz is gone or won&apos;t co-sign. While Writz works, repay and release from your loan page instead.
        </p>
      </header>

      <div className="rc-grid">
        <section className="rc-lock" aria-labelledby="rc-lock">
          <h2 id="rc-lock" className="rc-h2">
            What the lock is
          </h2>
          <p className="rc-lead">
            Your BTC sits in a Bitcoin address that two keys control: yours and Writz&apos;s. Together they release it when you
            repay. After your loan&apos;s timelock block, your key alone can move it.
          </p>
        </section>

        <section className="rc-when wz-cut" aria-labelledby="rc-when">
          <h2 id="rc-when" className="rc-h2">
            When
          </h2>
          <p>Each loan has its own timelock block, set when you deposited. Your loans on this device:</p>
          <ReclaimLoans />
        </section>

        <section className="rc-need" aria-labelledby="rc-need">
          <h2 id="rc-need" className="rc-h2">
            What you need
          </h2>
          <ul className="wz-need">
            <li>
              <b>Your Bitcoin wallet&apos;s key</b>, the one that made the deposit. Writz cannot recover it.
            </li>
            <li>
              <b>The deposit&apos;s details</b>: lock address, transaction ID and output, amount and timelock block. Your loan
              backup has them; download it from the Wallets menu.
            </li>
            <li>
              <b>A computer that can run the reference script</b> in the docs.
            </li>
          </ul>
        </section>
      </div>

      <section className="rc-steps-wrap" aria-labelledby="rc-steps">
        <h2 id="rc-steps" className="rc-h2">
          Steps
        </h2>
        <ol className="rc-steps">
          {STEPS.map(([title, body], i) => (
            <li key={title}>
              <span className="rc-step-n mono" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="rc-h3">{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
        <p className="wz-hint">There is no in-app reclaim yet; the script in the docs is the way to do it today.</p>
        <ExternalLink href={RECLAIM_DOCS_URL} className="wz-link fu-textlink">
          Reference script and checks in the docs
        </ExternalLink>
      </section>
    </article>
  );
}
