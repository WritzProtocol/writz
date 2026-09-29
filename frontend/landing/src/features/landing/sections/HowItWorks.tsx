import { DOCS_URL } from "../constants";

const STEPS = [
  {
    title: "Connect your wallets",
    body: "Use the Bitcoin wallet you already have, plus a Stellar wallet to receive dollars. Writz never asks for your keys and never takes possession of your coins.",
  },
  {
    title: "Choose your amount",
    body: "Borrow up to two thirds of what your Bitcoin is worth, in dollars, once your deposit confirms on Bitcoin. Borrowing less leaves more room before liquidation.",
  },
  {
    title: "Repay when you like",
    body: "Pay back the loan plus interest on your own schedule. Writz co-signs the release and your Bitcoin returns to your wallet.",
  },
];

export function HowItWorks() {
  return (
    <section id="how">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <div>
            <p className="eyebrow">How it works</p>
            <h2>Three steps, and your Bitcoin never changes hands.</h2>
          </div>
          <a className="link-rule" href={`${DOCS_URL}/introduction/how-writz-works`}>
            Read the details
          </a>
        </div>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div className="step" key={s.title} data-reveal>
              <div className="n">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
        <p className="assurance" data-reveal>
          At no point does Writz hold your Bitcoin, and if Writz ever disappeared, you could reclaim it alone once the timelock expires.
        </p>
      </div>
    </section>
  );
}
