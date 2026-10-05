import type { Metadata } from "next";
import Link from "next/link";
import { statSync } from "node:fs";
import { join } from "node:path";
import { env } from "@/config/env";
import { workSans } from "@/features/landing/fonts";
import { DOCS_URL, GITHUB_URL } from "@/features/landing/constants";
import { CopyButton } from "../brand/CopyButton";
import "../brand/press.css";
import "./whitepaper.css";

const TITLE = "Writz Protocol whitepaper";
const SUBTITLE =
  "Trustless Bitcoin Lending with Zero-Knowledge Position Privacy on Stellar";
const DESCRIPTION =
  "The technical whitepaper for Writz Protocol: stateless Bitcoin SPV verification, Groth16 position privacy and a Bitcoin lending market on Stellar Soroban.";

const PDF_PATH = "/whitepaper/writz-protocol-whitepaper.pdf";
const PAGES = 21;
const VERSION = "1.0";
const DATE_LABEL = "July 2026";
const AUTHOR = "Sebastián Salazar Solano";

export const metadata: Metadata = {
  title: `${TITLE} - Writz`,
  description: DESCRIPTION,
  alternates: { canonical: "/whitepaper" },
  openGraph: {
    type: "article",
    siteName: "Writz",
    title: `${TITLE}: ${SUBTITLE}`,
    description: DESCRIPTION,
    url: "/whitepaper",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Writz Protocol" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@WritzProtocol",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

const ABSTRACT = [
  "Existing Bitcoin DeFi protocols force users to choose between custodial risk, where a bridge operator holds the coins, and public exposure, where every position size is visible to all observers. Writz Protocol is a Bitcoin lending protocol on Stellar's Soroban smart contract platform that combines SPV-verified native BTC collateral with zero-knowledge position privacy.",
  "The protocol makes three technical contributions: a stateless Bitcoin SPV client on Soroban that verifies P2WSH locking transactions without on-chain header storage or trusted relayers; a Groth16 commitment scheme over BN254 that hides collateral, debt and liquidation thresholds while the chain still enforces the lending invariants; and PrivateLend, a lending market with a two-slope interest rate model calibrated for Bitcoin collateral and a multi-oracle price aggregator conforming to SEP-40.",
];

const CONTRIBUTIONS = [
  {
    name: "Stateless SPV on Soroban.",
    text: "A contract verifies Bitcoin transaction inclusion from block headers and a Merkle proof supplied at call time. Nothing is stored and no relayer is trusted.",
  },
  {
    name: "Private positions.",
    text: "Positions are Poseidon commitments in a Merkle tree. Groth16 proofs let the chain enforce collateral ratios and liquidations without learning amounts.",
  },
  {
    name: "A lending market.",
    text: "PrivateLend, with a kinked interest rate model, ZK-private liquidation proofs and a median oracle, plus security propositions with proof arguments.",
  },
];

const CONTENTS = [
  { n: "1", name: "Introduction", note: "Custodial risk, positional transparency, and the three technologies that make Writz Protocol possible." },
  { n: "2", name: "Background", note: "Bitcoin SPV, Groth16, BN254, Poseidon and Soroban." },
  { n: "3", name: "Related work", note: "BTC Relay, summa-tx, interBTC, Aztec and Stellar Private Payments." },
  { n: "4", name: "Protocol design", note: "P2WSH custody, stateless SPV verification, the four circuits, the interest rate model, liquidation and oracles." },
  { n: "5", name: "Security analysis", note: "Threat model, custody safety, computational privacy and double-spend resistance." },
  { n: "6", name: "Economic model", note: "Revenue streams, fee distribution and conservative projections." },
  { n: "7", name: "Implementation", note: "Contract suite, compute costs and circuit performance." },
  { n: "8", name: "Conclusion and future work", note: "Phase 2 and Phase 3, and post-quantum preparedness." },
  { n: "A", name: "Testnet deployment records", note: "Bitcoin Signet and Soroban testnet evidence." },
];

const CITATION_TEXT = `${AUTHOR}. "Writz Protocol: ${SUBTITLE}." Version ${VERSION}, ${DATE_LABEL}. ${env.siteUrl}/whitepaper`;

const BIBTEX = `@misc{salazar2026writz,
  author = {Salazar Solano, Sebasti{\\'a}n},
  title  = {Writz Protocol: ${SUBTITLE}},
  year   = {2026},
  month  = jul,
  note   = {Version ${VERSION}},
  url    = {${env.siteUrl}/whitepaper}
}`;

function pdfSize(): string {
  try {
    const bytes = statSync(join(process.cwd(), "public", PDF_PATH)).size;
    return `${Math.round(bytes / 1024)} KB`;
  } catch {
    return "";
  }
}

export default function WhitepaperPage() {
  const size = pdfSize();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: `Writz Protocol: ${SUBTITLE}`,
    name: `${TITLE}`,
    description: DESCRIPTION,
    inLanguage: "en",
    version: VERSION,
    datePublished: "2026-07",
    url: `${env.siteUrl}/whitepaper`,
    author: { "@type": "Person", name: AUTHOR },
    publisher: {
      "@type": "Organization",
      name: "Writz Protocol",
      url: env.siteUrl,
      sameAs: [GITHUB_URL, "https://x.com/WritzProtocol"],
    },
    isAccessibleForFree: true,
    encoding: {
      "@type": "MediaObject",
      contentUrl: `${env.siteUrl}${PDF_PATH}`,
      encodingFormat: "application/pdf",
    },
  };

  return (
    <div className={`${workSans.variable} press-root`}>
      <script
        type="application/ld+json"
        // Static, build-time data only; nothing user-supplied reaches this.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="masthead">
        <div className="wrap">
          <Link href="/" aria-label="Writz home" style={{ display: "inline-block" }}>
            <div className="lockup" role="img" aria-label="Writz" />
          </Link>
          <h1>{TITLE}</h1>
          <p className="lead">{SUBTITLE}.</p>

          <ul className="doc-meta">
            <li>
              <strong>Version</strong> {VERSION}
            </li>
            <li>
              <strong>Date</strong> {DATE_LABEL}
            </li>
            <li>
              <strong>Author</strong> {AUTHOR}
            </li>
            <li>
              <strong>PDF</strong> {PAGES} pages{size ? `, ${size}` : ""}
            </li>
          </ul>

          <div className="doc-actions">
            <a className="btn primary" href={PDF_PATH} download>
              Download the PDF
            </a>
            <a className="btn" href={DOCS_URL}>
              Read the docs
            </a>
          </div>
        </div>
      </header>

      <main className="wrap">
        <section>
          <p className="label">Abstract</p>
          <h2>What the paper argues</h2>
          {ABSTRACT.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
          <p className="caption">
            Writz Protocol is live on Stellar testnet, not mainnet. The paper is informational and is
            not financial advice or an offer of any security.
          </p>
        </section>

        <section>
          <p className="label">Contributions</p>
          <h2>Three pieces</h2>
          <ol className="contributions">
            {CONTRIBUTIONS.map((c) => (
              <li key={c.name}>
                <strong>{c.name}</strong> {c.text}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <p className="label">Contents</p>
          <h2>Inside the paper</h2>
          <ol className="contents">
            {CONTENTS.map((c) => (
              <li key={c.n}>
                <span className="num">{c.n}</span>
                <span>
                  <span className="name">{c.name}</span>
                  <span className="note">{c.note}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <p className="label">Cite</p>
          <h2>Citing this paper</h2>
          <blockquote>
            <div className="head">
              <span className="name">Plain text</span>
              <CopyButton text={CITATION_TEXT} />
            </div>
            <p>{CITATION_TEXT}</p>
          </blockquote>
          <blockquote style={{ marginTop: 16 }}>
            <div className="head">
              <span className="name">BibTeX</span>
              <CopyButton text={BIBTEX} />
            </div>
            <pre className="cite">{BIBTEX}</pre>
          </blockquote>
        </section>
      </main>

      <footer className="colophon">
        <div className="wrap">
          <Link href="/">writz.xyz</Link> · <a href={DOCS_URL}>Docs</a> ·{" "}
          <a href={GITHUB_URL} rel="noreferrer">
            GitHub
          </a>{" "}
          ·{" "}
          <a href="https://x.com/WritzProtocol" rel="me noreferrer">
            @WritzProtocol
          </a>
        </div>
      </footer>
    </div>
  );
}
