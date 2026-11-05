import type { Metadata } from "next";
import { env } from "@/config/env";
import { OG_IMAGE, ORGANIZATION_ID, SITE_NAME, WEBSITE_ID } from "@/config/site";
import { workSans } from "@/features/landing/fonts";
import { Navbar } from "@/features/landing/sections/Navbar";
import { Footer } from "@/features/landing/sections/Closing";
import { DOCS_URL, GITHUB_URL } from "@/features/landing/constants";
import { explorerUrl, ledger } from "@/features/landing/data/contracts.data";
import "@/features/landing/landing.css";
import "../brand/press.css";
import "./about.css";

const META_TITLE = "About Writz Protocol";
const META_DESCRIPTION =
  "Writz Protocol is a Bitcoin lending protocol on Stellar backed by native BTC. Who builds it, where it stands and how to check it.";

export const metadata: Metadata = {
  title: META_TITLE,
  description: META_DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: META_TITLE,
    description: META_DESCRIPTION,
    url: "/about",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    site: "@WritzProtocol",
    title: META_TITLE,
    description: META_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

const CONTACT_EMAIL = "contact@writz.xyz";

const TEAM = [
  {
    name: "Miguel Nieto",
    initials: "MN",
    role: "Co-founder, Product Lead",
    scope: "Product direction, partnerships and the lending protocol.",
    github: "miguelnietoa",
    x: "miguelnietoa_",
    linkedin: "miguelnietoa",
  },
  {
    name: "Sebastián Salazar",
    initials: "SS",
    role: "Co-founder, Protocol Engineering Lead",
    scope: "How Bitcoin is locked, verified on Stellar and released.",
    github: "salazarsebas",
    x: "salazarsebas_cr",
    linkedin: "sebastian-salazar-solano",
  },
  {
    name: "Kevin Membreño",
    initials: "KM",
    role: "Co-founder, Frontend Lead",
    scope: "The app people use to borrow and lend.",
    github: "KevinMB0220",
    x: "KevinMembr95392",
    linkedin: "kevin-brenes-2a9750261",
  },
  {
    name: "Josue Araya",
    initials: "JA",
    role: "Co-founder, Infrastructure Lead",
    scope: "The services that keep the protocol running safely.",
    github: "Josue19-08",
    x: "josuearayamarin",
    linkedin: "josue-araya-marin",
  },
];

const STATUS = [
  { k: "Network", v: "Live on Stellar testnet, with test BTC and test USDC. Not on mainnet." },
  { k: "Positions", v: "Every position is public on chain, like in any other lending market." },
  { k: "Audit", v: "Not audited yet. The contracts are open source under Apache 2.0." },
  { k: "Token", v: "There is no Writz token." },
];

const PROOF = [
  { name: "Source code", note: "Every contract and app, Apache 2.0.", where: "GitHub", href: GITHUB_URL, mono: false },
  ...ledger
    .filter((c) => c.name !== "Earn vault")
    .map((c) => ({ name: c.name, note: `${c.role}.`, where: "Stellar Expert", href: explorerUrl(c.address), mono: true })),
  { name: "Whitepaper", note: "Version 1.0, archived on Zenodo with a DOI.", where: "Whitepaper", href: "/whitepaper", mono: false },
  { name: "Documentation", note: "How it works, including the security model.", where: "Docs", href: DOCS_URL, mono: false },
];

const profileUrls = (m: (typeof TEAM)[number]) => [
  `https://github.com/${m.github}`,
  `https://x.com/${m.x}`,
  `https://www.linkedin.com/in/${m.linkedin}/`,
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": `${env.siteUrl}/about#page`,
  url: `${env.siteUrl}/about`,
  name: META_TITLE,
  isPartOf: { "@id": WEBSITE_ID },
  about: {
    "@id": ORGANIZATION_ID,
    "@type": "Organization",
    name: SITE_NAME,
    email: CONTACT_EMAIL,
    founder: TEAM.map((m) => ({ "@type": "Person", name: m.name, sameAs: profileUrls(m) })),
  },
};

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4 12 12 4M6 4h6v6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function AboutPage() {
  return (
    <div className={`${workSans.variable} landing press-root about`}>
      <script
        type="application/ld+json"
        // Static, build-time data only; nothing user-supplied reaches this.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />
      <header className="masthead">
        <div className="field" aria-hidden="true" />
        <div className="wrap mast-in">
          <div className="mast-copy">
            <h1>Writz Protocol</h1>
            <p className="lead">
              Writz is a lending protocol on Stellar backed by native BTC. A Bitcoin Script holds the
              collateral on Bitcoin itself rather than a company, and it never becomes a wrapped token.
              Borrow USDC against it, repay on your own schedule, and recover your Bitcoin even if Writz
              disappears.
            </p>
          </div>
          <section id="status" className="status" aria-labelledby="status-h">
            <h2 id="status-h">Where it stands</h2>
            <dl>
              {STATUS.map((s) => (
                <div key={s.k}>
                  <dt>
                    <span className="tick" aria-hidden="true" />
                    {s.k}
                  </dt>
                  <dd>{s.v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </header>

      <div className="wrap">
        <section id="team" aria-labelledby="team-h">
          <div className="sec-head">
            <h2 id="team-h">Who builds it</h2>
            <p>Four cofounders across Latin America.</p>
          </div>
          <ul className="team">
            {TEAM.map((m) => (
              <li key={m.name}>
                <div className="avatar" aria-hidden="true">
                  <span>{m.initials}</span>
                  <i style={{ backgroundImage: `url(https://github.com/${m.github}.png?size=192)` }} />
                </div>
                <h3>{m.name}</h3>
                <p className="role">{m.role}</p>
                <p className="scope">{m.scope}</p>
                <p className="links">
                  <a href={`https://github.com/${m.github}`} rel="noreferrer" aria-label={`${m.name} on GitHub`}>
                    GitHub
                  </a>
                  <a href={`https://x.com/${m.x}`} rel="noreferrer" aria-label={`${m.name} on X`}>
                    X
                  </a>
                  <a
                    href={`https://www.linkedin.com/in/${m.linkedin}/`}
                    rel="noreferrer"
                    aria-label={`${m.name} on LinkedIn`}
                  >
                    LinkedIn
                  </a>
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section id="recognition" aria-labelledby="recognition-h">
          <div className="sec-head">
            <h2 id="recognition-h">Recognition</h2>
            <p>What the work has earned so far.</p>
          </div>
          <ul className="awards">
            <li>
              <span className="kind">Hackathon</span>
              <span className="what">Winners of Pulso Hackathon Colombia</span>
              <span className="detail">First place, 2026</span>
              <a href="https://dorahacks.io/hackathon/stellar-pulso-hackathon/detail" rel="noreferrer">
                See the hackathon
                <Arrow />
              </a>
            </li>
            <li>
              <span className="kind">Grants</span>
              <span className="what">Two Stellar Community Fund Instawards</span>
              <span className="detail">Awarded in 2026</span>
              <a href="https://communityfund.stellar.org" rel="noreferrer">
                About the Stellar Community Fund
                <Arrow />
              </a>
            </li>
          </ul>
        </section>

        <section id="check" aria-labelledby="check-h">
          <div className="sec-head">
            <h2 id="check-h">Check it yourself</h2>
            <p>The code, the deployed contracts and the papers behind them.</p>
          </div>
          <ul className="proof">
            {PROOF.map((p) => (
              <li key={p.name}>
                <a href={p.href} rel={p.href.startsWith("/") ? undefined : "noreferrer"}>
                  <span className={p.mono ? "nm mono" : "nm"}>{p.name}</span>
                  <span className="note">{p.note}</span>
                  <span className="where">
                    {p.where}
                    <Arrow />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section id="contact" aria-labelledby="contact-h">
          <h2 id="contact-h">Contact</h2>
          <a className="email" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          <p>
            Or{" "}
            <a href="https://x.com/WritzProtocol" rel="me noreferrer">
              @WritzProtocol
            </a>{" "}
            on X. Logos and approved descriptions are on the <a href="/brand">brand page</a>.
          </p>
        </section>
      </div>
      <Footer />
    </div>
  );
}
