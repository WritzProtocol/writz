import type { Metadata } from "next";
import { workSans } from "@/features/landing/fonts";
import { CopyButton } from "./CopyButton";
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

const INK = "#001D3D";
const GOLD = "#FFC300";
const PAPER = "#F6F7F8";
const MIDNIGHT = "#000814";

const ASSETS = [
  { name: "Horizontal lockup", file: "writz-lockup", h: 40 },
  { name: "Stacked lockup", file: "writz-lockup-stacked", h: 72 },
  { name: "Mark", file: "writz-mark", h: 48 },
  { name: "Wordmark", file: "writz-wordmark", h: 28 },
];

const COLOURS = [
  { name: "Paper", hex: PAPER, role: "The ground. Everything starts here." },
  { name: "Ink", hex: INK, role: "Type, and the mark." },
  { name: "Deep", hex: "#003566", role: "Rules, second series, secondary type." },
  { name: "Gold", hex: GOLD, role: "The accent. A surface, not type." },
  { name: "Midnight", hex: MIDNIGHT, role: "The dark block." },
];

const PAIRS = [
  { aa: INK, on: PAPER, label: "Ink on Paper", ratio: "15.8:1", fail: false },
  { aa: INK, on: GOLD, label: "Ink on Gold", ratio: "10.5:1", fail: false, ground: "on-gold" },
  { aa: PAPER, on: MIDNIGHT, label: "Paper on Midnight", ratio: "18.7:1", fail: false, ground: "on-dark" },
  { aa: GOLD, on: PAPER, label: "Gold on Paper", ratio: "1.5:1", fail: true },
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
  { spec: "Display · 68 · 600 · -0.032em", size: 68, weight: 600, tracking: "-0.032em", text: "Lock real BTC" },
  { spec: "H1 · 52 · 600 · -0.028em", size: 52, weight: 600, tracking: "-0.028em", text: "Borrow USDC on Stellar" },
  { spec: "H2 · 36 · 600 · -0.022em", size: 36, weight: 600, tracking: "-0.022em", text: "No bridge, no custodian" },
  { spec: "Body · 17 · 400", size: 17, weight: 400, tracking: "0", text: "The collateral stays on Bitcoin, held by a Bitcoin Script." },
  { spec: "Label · 13 · 500 · 0.06em", size: 13, weight: 500, tracking: "0.06em", text: "COLLATERAL", upper: true },
  { spec: "Data · 16 · mono · tabular", size: 16, weight: 400, tracking: "0", text: "CB2BD6QC…NCKKNIVA · 0.0412 BTC", mono: true },
];

const ONE_LINE =
  "Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token.";

const BOILERPLATE =
  "Writz is a lending protocol built on Stellar and backed by native BTC. It lets Bitcoin holders borrow dollars against their coins without handing them to a custodian and without converting them into a wrapped token: the collateral stays on Bitcoin, held by a Bitcoin Script, while the loan runs on Soroban. Positions are recorded as commitments, so a loan is visible on chain without its owner or its size being visible with it. The protocol is open source under Apache 2.0 and is currently live on Stellar testnet. Learn more at writz.xyz.";

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
    <div className={`${workSans.variable} press-root`}>
      <header className="masthead">
        <div className="wrap">
          <div className="lockup" role="img" aria-label="Writz" />
          <h1>Brand assets</h1>
          <p className="lead">
            Free to use to refer to us. The rules are at the bottom. Anything else, ask on{" "}
            <a href={CONTACT} rel="me noreferrer">
              X
            </a>
            .
          </p>
        </div>
      </header>

      <div className="wrap">
        <section>
          <p className="label">Logo</p>
          <h2>Four forms, three fills</h2>

          <div className="assets">
            {ASSETS.map((a) => (
              <div className="asset" key={a.file}>
                <div className="stage">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/brand/${a.file}-black.svg`} alt={a.name} style={{ height: a.h }} />
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
            <div className="asset reversed">
              <div className="stage">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/writz-lockup-white.svg" alt="Writz reversed" style={{ height: 40 }} />
              </div>
              <div className="meta">
                <span className="name">Reversed</span>
                <span className="files">
                  <a href="/brand/writz-lockup-white.svg" download>
                    svg
                  </a>
                </span>
              </div>
            </div>
          </div>
          <p className="caption">
            The unsuffixed file takes its colour from CSS. Use <code>-black</code> and{" "}
            <code>-white</code> when you do not control the styling.
          </p>
        </section>

        <section>
          <p className="label">Clear space</p>
          <h2>Half the mark, on every side</h2>
          <div className="clearspace">
            <div className="box" style={{ padding: markH / 2 }}>
              <span className="unit" style={{ width: markH / 2, height: markH / 2 }} />
              <div className="mark" style={{ height: markH, color: INK }} />
            </div>
          </div>
          <p className="caption">
            Nothing enters the dashed box. Not a tagline, not a partner logo, not the edge of a
            photograph.
          </p>
        </section>

        <section>
          <p className="label">Size</p>
          <h2>Twenty pixels tall, not wide</h2>
          <div className="ladder">
            {SIZES.map((s) => (
              <div className={`step ${s.state ?? ""}`} key={s.px}>
                <div className="slot">
                  <div className="mark" style={{ height: s.px, color: INK }} />
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

        <section>
          <p className="label">Colour</p>
          <h2>Navy and gold</h2>
          <div className="swatches">
            {COLOURS.map((c) => (
              <div className="swatch" key={c.hex}>
                <div className="chip" style={{ background: c.hex }} />
                <div className="name">{c.name}</div>
                <div className="hex">{c.hex}</div>
                <div className="role">{c.role}</div>
              </div>
            ))}
          </div>

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
                  {p.ratio} {p.fail ? "· fails" : ""}
                </div>
              </div>
            ))}
          </div>
          <p className="caption">
            WCAG asks 4.5:1 for normal text. The last one is the most common way this palette gets
            broken.
          </p>
        </section>

        <section>
          <p className="label">Type</p>
          <h2>Work Sans</h2>
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

        <section>
          <p className="label">Graphic language</p>
          <h2>One angle, two colours</h2>
          <div className="gfx">
            <div className="cell">
              <div className="cap">The cut</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ ...shear(64, 30), background: "#003566" }} />
                <span style={{ ...shear(64, 30), background: GOLD }} />
                <span className="note">skewX(-16°)</span>
              </div>
            </div>

            <div className="cell">
              <div className="cap">Shard rule</div>
              <div className="strip" style={{ background: MIDNIGHT, marginBottom: 8 }}>
                {BARS.map((x) => (
                  <span key={x} style={{ left: x, background: GOLD }} />
                ))}
              </div>
              <div className="strip" style={{ background: PAPER }}>
                {BARS.map((x) => (
                  <span key={x} style={{ left: x, background: "#003566" }} />
                ))}
              </div>
            </div>

            <div className="cell">
              <div className="cap">Redaction bar</div>
              <div className="redact">
                <span>Collateral</span>
                <span style={{ ...shear(92, 17), background: INK }} />
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
                  <span key={o} style={{ background: "#003566", opacity: o }} />
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

        <section>
          <p className="label">Copy</p>
          <h2>Describing Writz</h2>

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

        <section>
          <p className="label">Do not</p>
          <h2>Six ways to break it</h2>
          <div className="dont">
            <figure>
              <div className="stage">
                <div
                  className="mark"
                  style={{ height: 44, color: INK, transform: "scaleX(1.6)" }}
                />
              </div>
              <figcaption>Stretch it</figcaption>
            </figure>
            <figure>
              <div className="stage">
                <div
                  className="mark"
                  style={{ height: 44, color: INK, transform: "rotate(-14deg)" }}
                />
              </div>
              <figcaption>Rotate or skew it</figcaption>
            </figure>
            <figure>
              <div className="stage">
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

        <section>
          <p className="label">Rules</p>
          <h2>What you can do with these</h2>
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

      <footer className="colophon">
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
      </footer>
    </div>
  );
}
