import { APP_ROUTE, DOCS_URL } from "../constants";
import { footerLinkGroups } from "../data/footerLinks.data";

export function ClosingCard() {
  return (
      <div className="wrap card-slot">
        <div className="closing dark">
          <div className="closing-inner" data-reveal>
            <div>
              <h2>
                Your Bitcoin is already yours.
                <br />
                Start using it that way.
              </h2>
              <p>Test funds only. Writz never asks for your keys.</p>
            </div>
            <div className="ctas">
              <a className="btn btn-gold" href={APP_ROUTE}>
                Open app
              </a>
              <a className="btn btn-line" href={DOCS_URL}>
                Read the docs
              </a>
            </div>
          </div>
        </div>
      </div>
  );
}

export function Footer() {
  return (
      <footer className="foot dark">
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <span className="lockup" />
              <p className="bio">Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token.</p>
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
          <div className="legal">
            <span>© 2026 Writz Protocol. Open source under Apache 2.0.</span>
          </div>
        </div>
      </footer>
  );
}
