import type { Metadata } from "next";
import { workSans } from "@/features/landing/fonts";
import { Navbar } from "@/features/landing/sections/Navbar";
import { Footer } from "@/features/landing/sections/Closing";
import { CopyButton } from "./CopyButton";
import "@/features/landing/landing.css";
import "./press.css";

export const metadata: Metadata = {
  title: "Brand assets - Writz",
  description:
    "Logos, colours and approved descriptions of Writz, for press, listings and ecosystem directories.",
  alternates: { canonical: "/brand" },
};

/**
 * Not an email. writz.xyz has no MX record and mail to it does not arrive,
 * which already cost the project one lost security disclosure. See
 * docs/security/bug-bounty.md. Swap this for a mailbox once one exists.
 */
const CONTACT = "https://x.com/WritzProtocol";

const INK = "#15181E";
const GOLD = "#FFC300";
const PAPER = "#F6F7F8";
const DEEP = "#2A303A";
const GRAPHITE = "#0C0E12";

const ASSETS = [
  { name: "Horizontal lockup", file: "writz-lockup", h: 40 },
  { name: "Stacked lockup", file: "writz-lockup-stacked", h: 72 },
  { name: "Mark", file: "writz-mark", h: 48 },
  { name: "Wordmark", file: "writz-wordmark", h: 28 },
];

const COLOURS = [
  { name: "Paper", hex: PAPER, role: "The light ground. Every document, slide and printed page starts here." },
  { name: "Ink", hex: INK, role: "Type and the mark on Paper. The panel on a dark ground." },
  { name: "Deep", hex: DEEP, role: "Rules, second series, meter tracks, the tint ladder." },
  { name: "Gold", hex: GOLD, role: "The accent. A surface, and type only on dark grounds." },
  { name: "Graphite", hex: GRAPHITE, role: "The dark ground. The product, banners, merch." },
];

const GREYS = [
  { name: "Body on Paper", hex: "#4B515B", note: "7.45:1 on Paper" },
  { name: "Muted on Paper", hex: "#646A73", note: "5.08:1 on Paper" },
  { name: "Rule on Paper", hex: "#E2E4E8", note: "Hairlines on Paper" },
  { name: "Body on Graphite", hex: "#B6BBC4", note: "10.02:1 on Graphite" },
  { name: "Muted on Graphite", hex: "#8B919B", note: "6.09:1 on Graphite" },
];

const PAIRS = [
  { aa: INK, on: GOLD, label: "Ink on Gold", ratio: "11.05:1", ground: "on-gold" },
  { aa: INK, on: PAPER, label: "Ink on Paper", ratio: "16.57:1" },
  { aa: PAPER, on: GRAPHITE, label: "Paper on Graphite", ratio: "18.01:1" },
  { aa: GOLD, on: GRAPHITE, label: "Gold on Graphite", ratio: "12.01:1" },
  { aa: GOLD, on: INK, label: "Gold on Ink", ratio: "11.05:1" },
  { aa: GOLD, on: PAPER, label: "Gold on Paper", ratio: "1.50:1", fail: true },
];

const STATUS = [
  {
    name: "Danger",
    use: "Liquidation, a failed transaction, a position at risk.",
    paper: { hex: "#B0453A", ratio: "5.21:1" },
    dark: { hex: "#E5786C", graphite: "6.65:1", ink: "6.12:1" },
  },
  {
    name: "Positive",
    use: "Confirmed, supplied, repaid.",
    paper: { hex: "#1F7A5A", ratio: "4.91:1" },
    dark: { hex: "#4FBF8F", graphite: "8.45:1", ink: "7.77:1" },
  },
  {
    name: "Warning",
    use: "Approaching a threshold. Always with its label.",
    paper: { hex: "#9C5D00", ratio: "4.92:1" },
    dark: { hex: "#F0A33A", graphite: "9.20:1", ink: "8.47:1" },
  },
  {
    name: "Info",
    use: "Neutral notices, pending states.",
    paper: { hex: DEEP, ratio: "12.37:1" },
    dark: { hex: "#8FB0D8", graphite: "8.62:1", ink: "7.93:1" },
  },
];

const PRODUCT_TYPE = [
  { label: "Heading", aa: "#F4F5F7", bg: "17.71:1", surface: "16.30:1" },
  { label: "Body", aa: "#B6BBC4", bg: "10.02:1", surface: "9.22:1" },
  { label: "Muted", aa: "#8B919B", bg: "6.09:1", surface: "5.61:1" },
];

const SIZES = [
  { px: 48, tag: "48px" },
  { px: 32, tag: "32px" },
  { px: 24, tag: "24px" },
  { px: 20, tag: "20px floor", state: "floor" },
  { px: 16, tag: "16px", state: "dead" },
  { px: 11, tag: "11px tab", state: "dead" },
];

const TYPE = [
  { spec: "Display 68 / 600 / -0.032em", size: 68, weight: 600, tracking: "-0.032em", text: "Lock real BTC" },
  { spec: "H1 52 / 600 / -0.028em", size: 52, weight: 600, tracking: "-0.028em", text: "Borrow USDC on Stellar" },
  { spec: "H2 36 / 600 / -0.022em", size: 36, weight: 600, tracking: "-0.022em", text: "No bridge, no custodian" },
  { spec: "Body 17 / 400", size: 17, weight: 400, tracking: "0", text: "The collateral stays on Bitcoin, held by a Bitcoin Script." },
  { spec: "Label 13 / 500 / 0.06em", size: 13, weight: 500, tracking: "0.06em", text: "COLLATERAL", upper: true },
  { spec: "Data 16 / mono / tabular", size: 16, weight: 400, tracking: "0", text: "CBX23YKC…VCW7W4EO 0.04120000 BTC", mono: true },
];

const ONE_LINE =
  "Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token.";

const BOILERPLATE =
  "Writz is a lending protocol built on Stellar and backed by native BTC. It lets Bitcoin holders borrow dollars against their coins without handing them to a custodian and without converting them into a wrapped token: the collateral stays on Bitcoin, held by a Bitcoin Script, while the loan runs on Soroban. Positions are recorded on chain in the open, like in any other lending market. The protocol is open source under Apache 2.0 and is currently live on Stellar testnet. Learn more at writz.xyz.";

const ALLOWED = [
  "Refer to Writz in an article, listing, directory or slide.",
  "Scale the files and place them on any flat ground with enough contrast.",
  "Use the reversed files on dark grounds.",
];

const FORBIDDEN = [
  "Use it as your own icon, favicon or avatar.",
  "Imply that Writz endorses, audits or partners with you.",
  "Use it in the name of a token, fund or pool. There is no Writz token.",
];

const SECTIONS = [
  { id: "logo", label: "Logo" },
  { id: "clear-space", label: "Clear space" },
  { id: "size", label: "Size" },
  { id: "colour", label: "Colour" },
  { id: "type", label: "Type" },
  { id: "graphics", label: "Graphic language" },
  { id: "copy", label: "Copy" },
  { id: "misuse", label: "Do not" },
  { id: "rules", label: "Rules" },
];

const num = (i: number) => String(i + 1).padStart(2, "0");

function Head({ id, title }: { id: string; title: string }) {
  const i = SECTIONS.findIndex((s) => s.id === id);
  return (
    <>
      <p className="eyebrow">
        <span className="num">{num(i)}</span>
        {SECTIONS[i].label}
      </p>
      <h2>{title}</h2>
    </>
  );
}

const TINTS = [1, 0.72, 0.44, 0.2, 0.1];
// Pitch 46, bar 18. Generated past any cell width, the strip clips the rest.
const BARS = Array.from({ length: 24 }, (_, i) => -12 + i * 46);

/** A parallelogram at the brand's one angle. The offset is height dependent. */
function shear(w: number, h: number) {
  const off = +(h * Math.tan((16 * Math.PI) / 180)).toFixed(2);
  return {
    display: "inline-block",
    width: w,
    height: h,
    flex: "none",
    clipPath: `polygon(${off}px 0, 100% 0, calc(100% - ${off}px) 100%, 0 100%)`,
  } as const;
}

export default function BrandPage() {
  const markH = 168;

  return (
    <div className={`${workSans.variable} landing press-root`}>
      <Navbar />
      <header className="masthead">
        <div className="wrap">
          <p className="eyebrow">Press and partners</p>
          <h1>Brand assets</h1>
          <p className="lead">
            Free to use to refer to us. The rules are at the bottom. Anything else, ask on{" "}
            <a href={CONTACT} rel="me noreferrer">
              X
            </a>
            .
          </p>
          <ol className="index">
            {SECTIONS.map((sec, i) => (
              <li key={sec.id}>
                <a href={`#${sec.id}`}>
                  <span className="num">{num(i)}</span>
                  {sec.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <div className="wrap">
        <section id="logo">
          <Head id="logo" title="Four forms, three fills" />

          <div className="assets">
            {ASSETS.map((a) => (
              <div className="asset" key={a.file}>
                <div className="stage">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/brand/${a.file}-white.svg`} alt={a.name} style={{ height: a.h }} />
                </div>
                <div className="meta">
                  <span className="name">{a.name}</span>
                  <span className="files">
                    <a href={`/brand/${a.file}.svg`} download>
                      svg
                    </a>
                    <a href={`/brand/${a.file}-black.svg`} download>
                      black
                    </a>
                    <a href={`/brand/${a.file}-white.svg`} download>
                      white
                    </a>
                  </span>
                </div>
              </div>
            ))}
            <div className="asset">
              <div className="stage" style={{ background: PAPER }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/writz-lockup-black.svg" alt="Writz on a light ground" style={{ height: 40 }} />
              </div>
              <div className="meta">
                <span className="name">On Paper, for documents and print</span>
                <span className="files">
                  <a href="/brand/writz-lockup-black.svg" download>
                    black
                  </a>
                </span>
              </div>
            </div>
          </div>
          <p className="caption">
            The four forms sit on Graphite, the dark ground of writz.xyz, the app, banners and
            merch. Paper is the ground for documents and print. The unsuffixed file takes its colour
            from CSS. Use <code>-black</code> and{" "}
            <code>-white</code> when you do not control the styling.
          </p>
        </section>

        <section id="clear-space">
          <Head id="clear-space" title="Half the mark, on every side" />
          <div className="clearspace">
            <div className="box" style={{ padding: markH / 2 }}>
              <span className="unit" style={{ width: markH / 2, height: markH / 2 }} />
              <div className="mark" style={{ height: markH, color: PAPER }} />
            </div>
          </div>
          <p className="caption">
            Nothing enters the dashed box. Not a tagline, not a partner logo, not the edge of a
            photograph.
          </p>
        </section>

        <section id="size">
          <Head id="size" title="Twenty pixels tall, not wide" />
          <div className="ladder">
            {SIZES.map((s) => (
              <div className={`step ${s.state ?? ""}`} key={s.px}>
                <div className="slot">
                  <div className="mark" style={{ height: s.px, color: PAPER }} />
                </div>
                <div className="tag">{s.tag}</div>
              </div>
            ))}
          </div>
          <p className="caption">
            The mark is 1.452 times wider than tall, so a floor stated in width lets it be placed
            at 11px tall, where the five pieces close up. Below 20px the construction is gone. The
            favicon is the one exception, since a tab icon works on silhouette.
          </p>
        </section>

        <section id="colour">
          <Head id="colour" title="Graphite & Gold" />
          <p>
            One palette for every surface: writz.xyz, the app, documents, slides, print and merch.
            Paper is the ground for documents and print, Graphite the ground of the product.
          </p>
          <div className="swatches">
            {COLOURS.map((c) => (
              <div className="swatch" key={c.name}>
                <div className="chip" style={{ background: c.hex }} />
                <div className="name">{c.name}</div>
                <div className="hex">{c.hex}</div>
                <div className="role">{c.role}</div>
              </div>
            ))}
          </div>

          <h3>Greys</h3>
          <div className="swatches">
            {GREYS.map((c) => (
              <div className="swatch" key={c.name}>
                <div className="chip small" style={{ background: c.hex }} />
                <div className="name">{c.name}</div>
                <div className="hex">{c.hex}</div>
                <div className="role">{c.note}</div>
              </div>
            ))}
          </div>
          <p className="caption">
            Derived, not part of the five. In the product, <code>--surface-2</code>{" "}
            <code>#1C2027</code> raises an element on a panel and <code>--heading</code>{" "}
            <code>#F4F5F7</code> carries headings and values. Hairlines are white at 7 percent,
            strong rules white at 14 percent.
          </p>

          <h3>Gold is a surface, never type on paper</h3>
          <div className="pairs">
            {PAIRS.map((p) => (
              <div
                className={`pair ${p.ground ?? ""} ${p.fail ? "fail" : ""}`}
                key={p.label}
                style={{ background: p.on, color: p.aa }}
              >
                <div className="aa">Aa</div>
                <div className="ratio">
                  {p.ratio}
                  {p.fail ? " fails" : ""}
                </div>
                <div className="label">{p.label}</div>
              </div>
            ))}
          </div>
          <p className="caption">
            WCAG asks 4.5:1 for normal text. The last one is the most common way this palette gets
            broken.
          </p>

          <h3>Status, on paper and on dark</h3>
          <div className="pairs status">
            {STATUS.map((s) => (
              <div className="pair split" key={s.name}>
                <div className="half" style={{ background: PAPER, color: s.paper.hex }}>
                  <div className="label">{s.name}</div>
                  <div className="ratio">
                    {s.paper.hex} {s.paper.ratio}
                  </div>
                </div>
                <div className="half" style={{ background: GRAPHITE, color: s.dark.hex }}>
                  <div className="label">{s.name}</div>
                  <div className="ratio">
                    {s.dark.hex} {s.dark.graphite}
                  </div>
                  <div className="ratio">{s.dark.ink} on Ink</div>
                </div>
              </div>
            ))}
          </div>
          <p className="caption">
            {STATUS.map((s) => `${s.name}: ${s.use}`).join(" ")} Gold is the brand, never a
            status, and a user must never have to tell the two apart by hue, so a badge, a chart or
            a toast carries a label too. On dark, warning sits close to Gold and always carries its
            label.
          </p>

          <h3>Type on the product grounds</h3>
          <div className="pairs">
            {PRODUCT_TYPE.map((p) => (
              <div className="pair split" key={p.label} style={{ color: p.aa }}>
                <div className="half" style={{ background: GRAPHITE }}>
                  <div className="aa">Aa</div>
                  <div className="ratio">{p.bg} on Graphite</div>
                </div>
                <div className="half" style={{ background: INK }}>
                  <div className="label">{p.label}</div>
                  <div className="ratio">{p.surface} on Ink</div>
                </div>
              </div>
            ))}
          </div>
          <p className="caption">
            Graphite is <code>--bg</code> in the product and Ink is <code>--surface</code>, the
            panel. Gold stays type only on these dark grounds, never on paper.
          </p>
        </section>

        <section id="type">
          <Head id="type" title="Work Sans" />
          <div className="specimen">
            {TYPE.map((t) => (
              <div className="row" key={t.spec}>
                <div className="spec">{t.spec}</div>
                <div
                  className="sample"
                  style={{
                    fontSize: t.size,
                    fontWeight: t.weight,
                    letterSpacing: t.tracking,
                    textTransform: t.upper ? "uppercase" : "none",
                    fontFamily: t.mono ? "var(--ff-mono), ui-monospace, monospace" : undefined,
                  }}
                >
                  {t.text}
                </div>
              </div>
            ))}
          </div>
          <p className="caption">
            Tracking goes negative as size goes up and positive as it goes down. Values that come
            from a chain render in the mono, with tabular figures. Work Sans is under the{" "}
            <a href="https://fonts.google.com/specimen/Work+Sans" rel="noreferrer">
              SIL Open Font License
            </a>
            .
          </p>
        </section>

        <section id="graphics">
          <Head id="graphics" title="One angle, two colours" />
          <div className="gfx">
            <div className="cell">
              <div className="cap">The cut</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ ...shear(64, 30), background: DEEP }} />
                <span style={{ ...shear(64, 30), background: GOLD }} />
                <span className="note">skewX(-16°)</span>
              </div>
            </div>

            <div className="cell">
              <div className="cap">Shard rule</div>
              <div className="shard" style={{ background: GRAPHITE, marginBottom: 8 }}>
                {BARS.map((x) => (
                  <span key={x} style={{ left: x, background: GOLD }} />
                ))}
              </div>
              <div className="shard" style={{ background: PAPER }}>
                {BARS.map((x) => (
                  <span key={x} style={{ left: x, background: DEEP }} />
                ))}
              </div>
            </div>

            <div className="cell">
              <div className="cap">Redaction bar</div>
              <div className="redact">
                <span>Collateral</span>
                <span style={{ ...shear(92, 17), background: PAPER }} />
                <span>BTC</span>
              </div>
              <p className="note" style={{ marginTop: 14, lineHeight: 1.5 }}>
                A value that exists and is not disclosed. Never a placeholder.
              </p>
            </div>

            <div className="cell">
              <div className="cap">Tints</div>
              <div className="tints" style={{ marginBottom: 6 }}>
                {TINTS.map((o) => (
                  <span key={o} style={{ background: DEEP, opacity: o }} />
                ))}
              </div>
              <div className="tints">
                {TINTS.map((o) => (
                  <span key={o} style={{ background: GOLD, opacity: o }} />
                ))}
              </div>
            </div>
          </div>
          <p className="caption">
            The offset on a sheared box is its height times <code>tan(16°)</code>, which is 0.2867,
            not a fixed number. One angle, one radius family, tints of the two brand colours. No
            third hue, no gradients, no shadows.
          </p>
        </section>

        <section id="copy">
          <Head id="copy" title="Describing Writz" />

          <blockquote>
            <div className="head">
              <span className="name">One line</span>
              <CopyButton text={ONE_LINE} />
            </div>
            <p>{ONE_LINE}</p>
          </blockquote>

          <blockquote style={{ marginTop: 16 }}>
            <div className="head">
              <span className="name">Boilerplate</span>
              <CopyButton text={`About Writz\n\n${BOILERPLATE}`} />
            </div>
            <p>{BOILERPLATE}</p>
          </blockquote>

          <p className="caption">
            Writz is on Stellar testnet, not mainnet, and any description carries that. Independent
            software, not affiliated with or endorsed by the Stellar Development Foundation.
          </p>
        </section>

        <section id="misuse">
          <Head id="misuse" title="Six ways to break it" />
          <div className="dont">
            <figure>
              <div className="stage">
                <div
                  className="mark"
                  style={{ height: 44, color: PAPER, transform: "scaleX(1.6)" }}
                />
              </div>
              <figcaption>Stretch it</figcaption>
            </figure>
            <figure>
              <div className="stage">
                <div
                  className="mark"
                  style={{ height: 44, color: PAPER, transform: "rotate(-14deg)" }}
                />
              </div>
              <figcaption>Rotate or skew it</figcaption>
            </figure>
            <figure>
              <div className="stage" style={{ background: PAPER }}>
                <div className="mark" style={{ height: 44, color: GOLD }} />
              </div>
              <figcaption>Put gold on a light ground</figcaption>
            </figure>
            <figure>
              <div className="stage">
                {/* The filter sits on a wrapper: on the masked element itself the mask
                    clips the shadow away and the tile shows a clean mark. */}
                <div style={{ filter: "drop-shadow(0 8px 8px rgba(0,0,0,0.45))" }}>
                  <div
                    className="mark"
                    style={{
                      height: 44,
                      background: `linear-gradient(135deg, ${GOLD}, #6C3FD1)`,
                    }}
                  />
                </div>
              </div>
              <figcaption>Add shadow, glow or gradient</figcaption>
            </figure>
            <figure>
              <div className="stage busy">
                <span className="blocks" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                <div className="mark" style={{ height: 44, color: PAPER }} />
              </div>
              <figcaption>Place it on a busy ground</figcaption>
            </figure>
            <figure>
              <div className="stage">
                <div className="mark" style={{ height: 44, color: "#6C3FD1" }} />
              </div>
              <figcaption>Recolour it outside the palette</figcaption>
            </figure>
          </div>
          <p className="caption">
            Also: do not rebuild the lockup by setting the word next to the mark yourself. The gap,
            the cap height and the kerning are measured. Use <code>writz-lockup.svg</code>. If you
            need the mark inside a circle or a rounded square, the app icons are that form already,
            drawn with the right clear space. Do not make your own.
          </p>
        </section>

        <section id="rules">
          <Head id="rules" title="What you can do with these" />
          <div className="rules">
            <div>
              <ul className="allowed">
                {ALLOWED.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div>
              <ul className="forbidden">
                {FORBIDDEN.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="caption">
            Merchandise for sale, use on a physical product, and anything a reader could read as a
            Writz endorsement need to be cleared first.
          </p>
        </section>
      </div>

      <div className="colophon">
        <div className="wrap">
          Questions, or a use not covered here:{" "}
          <a href={CONTACT} rel="me noreferrer">
            @WritzProtocol
          </a>{" "}
          or{" "}
          <a href="https://github.com/WritzProtocol/writz/issues" rel="noreferrer">
            GitHub
          </a>
          .
        </div>
      </div>
      <Footer />
    </div>
  );
}
