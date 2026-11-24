import Link from "next/link";
import { APP_ROUTE, DOCS_URL } from "../constants";
import { footerLinkGroups } from "../data/footerLinks.data";
import * as l from "../styles";

export function ClosingCard() {
  return (
    <section className={l.close} aria-labelledby="close-h">
      <div className={l.wrap} data-reveal>
        <h2 id="close-h" className={l.closeHeading}>
          Your Bitcoin is already yours. <span>Start using it that way.</span>
        </h2>
        <p className={l.closeText}>Test funds only. Writz never asks for your keys.</p>
        <div className={l.closeCtas}>
          <a className={l.btn("gold")} href={APP_ROUTE} data-umami-event="open-app" data-umami-event-where="closing">
            Open app
          </a>
          <a className={l.btn()} href={DOCS_URL} data-umami-event="read-docs" data-umami-event-where="closing">
            Read the docs
          </a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className={l.footer}>
      <div className={l.wrap}>
        <div className={l.footerGrid}>
          <div>
            <Link className={l.footerHome} href="/" aria-label="Writz home">
              <span className={l.footerLockup} />
            </Link>
            <p className={l.footerBio}>Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token.</p>
          </div>
          {footerLinkGroups.map((g) => (
            <div key={g.title}>
              <h3 className={l.footerHeading}>{g.title}</h3>
              <ul className={l.footerList}>
                {g.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className={l.footerLink} data-umami-event="footer-link" data-umami-event-label={link.label}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className={l.footerLegal}>© 2026 Writz Protocol. Open source under Apache 2.0.</p>
      </div>
    </footer>
  );
}
