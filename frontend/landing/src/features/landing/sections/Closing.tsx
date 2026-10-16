import Link from "next/link";
import { APP_ROUTE, DOCS_URL } from "../constants";
import { footerLinkGroups } from "../data/footerLinks.data";

export function ClosingCard() {
  return (
    <section className="close" aria-labelledby="close-h">
      <div className="wrap" data-reveal>
        <h2 id="close-h">
          Your Bitcoin is already yours. <span>Start using it that way.</span>
        </h2>
        <p>Test funds only. Writz never asks for your keys.</p>
        <div className="ctas">
          <a className="btn btn-gold" href={APP_ROUTE}>
            Open app
          </a>
          <a className="btn" href={DOCS_URL}>
            Read the docs
          </a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="ft">
      <div className="wrap">
        <div className="ft-grid">
          <div>
            <Link className="ft-brand" href="/" aria-label="Writz home">
              <span className="lockup" />
            </Link>
            <p className="ft-bio">Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token.</p>
          </div>
          {footerLinkGroups.map((g) => (
            <div key={g.title}>
              <h3>{g.title}</h3>
              <ul>
                {g.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href}>{l.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="ft-legal">© 2026 Writz Protocol. Open source under Apache 2.0.</p>
      </div>
    </footer>
  );
}
