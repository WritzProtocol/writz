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
              Native Bitcoin lending protocol <span className="accent">on Stellar.</span>
            </h1>
            <p className="lead">
              Writz Protocol lets you borrow USDC without selling your Bitcoin. Your BTC stays on the Bitcoin network, with
              no custodian and no bridge.
            </p>
            <div className="ctas">
              <a className="btn btn-gold" href={APP_ROUTE} data-umami-event="open-app" data-umami-event-where="hero">
                Open app
              </a>
              <a className="btn" href="#how" data-umami-event="see-how-it-works" data-umami-event-where="hero">
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
