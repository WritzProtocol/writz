import { APP_ROUTE } from "../constants";
import { BorrowCalculator } from "./BorrowCalculator";
import * as l from "../styles";

const FACTS = [
  { k: "No custodian", v: "A Bitcoin Script holds it, not a company." },
  { k: "No wrapped token", v: "Your native BTC stays on Bitcoin. Nothing is bridged." },
  { k: "Your way out", v: "If Writz stops, you reclaim your BTC after the timelock." },
];

export function Hero() {
  return (
    <>
      <section className={l.hero} aria-labelledby="hero-h">
        <div className={l.heroField} aria-hidden="true" />
        <div className={l.heroIn}>
          <div>
            <span className={l.heroTag}>
              <span className={l.heroTagDot} />
              Live on Stellar testnet
            </span>
            <h1 id="hero-h" className={l.heroTitle}>
              Native Bitcoin lending protocol <span className={l.heroAccent}>on Stellar.</span>
            </h1>
            <p className={l.heroLead}>
              Writz Protocol lets you borrow USDC without selling your Bitcoin. Your BTC stays on the Bitcoin network, with
              no custodian and no bridge.
            </p>
            <div className={l.heroCtas}>
              <a className={l.btn("gold")} href={APP_ROUTE} data-umami-event="open-app" data-umami-event-where="hero">
                Open app
              </a>
              <a className={l.btn()} href="#how" data-umami-event="see-how-it-works" data-umami-event-where="hero">
                See how it works
              </a>
            </div>
            <p className={l.heroNote}>Testnet only: test BTC and test USDC, no real funds.</p>
          </div>
          <div className={l.heroVis}>
            <BorrowCalculator />
          </div>
        </div>
      </section>
      <div className={l.wrap}>
        <ul className={l.facts}>
          {FACTS.map((f, i) => (
            <li key={f.k} className={l.fact(i)}>
              <span className={l.factTick} aria-hidden="true" />
              <b>{f.k}</b>
              <span>{f.v}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
