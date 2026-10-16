import { DOCS_URL } from "../constants";

const STEPS = [
  {
    title: "Lock BTC on Bitcoin",
    body: "Your BTC goes into a Bitcoin Script address that only your key and Writz's can release together. It never leaves the Bitcoin chain.",
    btc: "Locked on Bitcoin",
    usdc: "0",
  },
  {
    title: "Prove it on Stellar",
    body: "A relayer brings proof of the deposit to Stellar, where a contract checks it against Bitcoin block headers. The proof crosses over. The coins do not.",
    btc: "Locked on Bitcoin",
    usdc: "0",
    ok: "Proof checked on Stellar",
  },
  {
    title: "Borrow dollars",
    body: "Take up to two thirds of your BTC's value in USDC, straight to your Stellar wallet. Borrowing less leaves more room before liquidation.",
    btc: "Locked on Bitcoin",
    usdc: "Borrowed",
  },
  {
    title: "Repay and unlock",
    body: "Pay back the loan plus interest whenever you like. Writz co-signs the release and your BTC returns to your wallet.",
    btc: "Back in your wallet",
    usdc: "Repaid",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="how" aria-labelledby="how-h">
      <div className="wrap sec-head" data-reveal>
        <h2 id="how-h">Your Bitcoin never leaves Bitcoin.</h2>
        <a className="textlink" href={`${DOCS_URL}/introduction/how-writz-works`}>
          Read the details
        </a>
      </div>

      <ol className="fields">
        {STEPS.map((s, i) => (
          <li className="field" key={s.title} data-reveal>
            <div className="card">
              <div className="prog" aria-hidden="true">
                {STEPS.map((_, j) => (
                  <i key={j} className={j <= i ? "on" : undefined} />
                ))}
              </div>
              <dl>
                <div>
                  <dt>Your BTC</dt>
                  <dd>{s.btc}</dd>
                </div>
                <div>
                  <dt>Your USDC</dt>
                  <dd className={s.usdc === "0" ? "v" : undefined}>{s.usdc}</dd>
                </div>
              </dl>
              {s.ok && (
                <p className="ok">
                  <span className="dot" aria-hidden="true" />
                  {s.ok}
                </p>
              )}
            </div>
            <div className="clause">
              <h3>
                <span className="sr">Step {i + 1}: </span>
                {s.title}
              </h3>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="wrap">
        <p className="assure" data-reveal>
          <span className="tick" aria-hidden="true" />
          <span>
            At no point does Writz hold your Bitcoin, and if Writz ever disappeared, you could reclaim it alone once the
            timelock expires.
          </span>
        </p>
      </div>
    </section>
  );
}
