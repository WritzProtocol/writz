import { APP_ROUTE } from "../constants";
import { BorrowCalculator } from "./BorrowCalculator";

const FACTS = [
  { k: "No custodian", v: "A Bitcoin Script holds it, not a company." },
  { k: "No wrapped token", v: "Your native BTC stays on Bitcoin. Nothing is bridged." },
  { k: "Your way out", v: "If Writz stops, you reclaim your BTC after the timelock." },
];

export function Hero() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-h">
        <div className="hero-field" aria-hidden="true" />
        <div className="wrap hero-in">
          <div className="hero-copy">
            <span className="tag">
              <span className="dot" />
              Live on Stellar testnet
            </span>
            <h1 id="hero-h">
              Lock Bitcoin. Borrow dollars. <span className="tell">Tell no one.</span>
            </h1>
            <p className="lead">
              Get dollars without selling your Bitcoin. It stays locked on Bitcoin by a script, not with a company, and
              never becomes a wrapped token.
            </p>
            <div className="ctas">
              <a className="btn btn-gold" href={APP_ROUTE}>
                Open app
              </a>
              <a className="btn" href="#how">
                See how it works
              </a>
            </div>
            <p className="note">Testnet only: test BTC and test USDC, no real funds.</p>
          </div>
          <div className="hero-vis">
            <BorrowCalculator />
          </div>
        </div>
      </section>
      <div className="wrap">
        <ul className="facts">
          {FACTS.map((f) => (
            <li key={f.k}>
              <span className="tick" aria-hidden="true" />
              <b>{f.k}</b>
              <span>{f.v}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
