import type { Metadata } from "next";
import { RECLAIM_DOCS_URL } from "@/lib/links";
import { ExternalLink } from "@/components/redesign/ui";
import { ReclaimLoans } from "@/components/reclaim/ReclaimLoans";
import "../../home.css";
import "../../reclaim.css";

export const metadata: Metadata = {
  title: "Reclaim your BTC without Writz | Writz",
  alternates: { canonical: "/help/reclaim" },
};

export default function ReclaimHelp() {
  return (
    <article className="rc-col">
      <header className="hm-head">
        <h1 className="hm-h1">How to reclaim your BTC without Writz</h1>
        <p className="hm-sub">
          For when Writz is gone or won&apos;t co-sign. While Writz works, repay and release from your loan page instead.
        </p>
      </header>

      <section className="rc-block" aria-labelledby="rc-lock">
        <h2 id="rc-lock" className="hm-h2">
          What the lock is
        </h2>
        <p>
          Your BTC sits in a Bitcoin address that two keys control: yours and Writz&apos;s. Together they release it when you
          repay. After your loan&apos;s timelock block, your key alone can move it.
        </p>
      </section>

      <section className="rc-block" aria-labelledby="rc-when">
        <h2 id="rc-when" className="hm-h2">
          When
        </h2>
        <p>Each loan has its own timelock block, set when you deposited. Your loans on this device:</p>
        <ReclaimLoans />
      </section>

      <section className="rc-block" aria-labelledby="rc-need">
        <h2 id="rc-need" className="hm-h2">
          What you need
        </h2>
        <ul className="fo-need">
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

      <section className="rc-block" aria-labelledby="rc-steps">
        <h2 id="rc-steps" className="hm-h2">
          Steps
        </h2>
        <ol className="hm-steps rc-steps">
          {[
            ["Wait for the timelock", "Bitcoin has to reach your loan's timelock block. Before that, the network rejects the reclaim."],
            ["Gather the details", "Take the deposit's details from your loan backup and have your Bitcoin key ready."],
            ["Build and sign", "Use the reference script from the docs with your key. Don't build it by hand in a generic wallet: one wrong setting gets it rejected."],
            ["Broadcast and check", "Send the signed transaction and follow it on mempool until it confirms."],
          ].map(([title, body], i) => (
            <li key={title}>
              <span className="hm-step-n" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h3 className="hm-h3">{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="wz-hint">There is no in-app reclaim yet; the script in the docs is the way to do it today.</p>
        <ExternalLink href={RECLAIM_DOCS_URL}>Reference script and checks in the docs</ExternalLink>
      </section>
    </article>
  );
}
