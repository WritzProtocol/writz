"use client";

import { useEffect, useRef, useState } from "react";
import { DOCS_URL } from "../constants";

const STEPS = [
  {
    title: "Lock BTC on Bitcoin",
    body: "Your BTC goes into a Bitcoin Script address that only your key and Writz's can release together. It never leaves the Bitcoin chain.",
  },
  {
    title: "Prove it on Stellar",
    body: "A relayer brings proof of the deposit to Stellar, where a contract checks it against Bitcoin block headers. The proof crosses over. The coins do not.",
  },
  {
    title: "Borrow dollars",
    body: "Take up to two thirds of your BTC's value in USDC, straight to your Stellar wallet. Borrowing less leaves more room before liquidation.",
  },
  {
    title: "Repay and unlock",
    body: "Pay back the loan plus interest whenever you like. Writz co-signs the release and your BTC returns to your wallet.",
  },
];

const STATUS: Record<number, [string, string]> = {
  [-1]: ["In your wallet", "0"],
  0: ["Locked on Bitcoin", "0"],
  1: ["Locked on Bitcoin", "0"],
  2: ["Locked on Bitcoin", "Borrowed"],
  3: ["Back in your wallet", "Repaid"],
};

export function HowItWorks() {
  const [stage, setStage] = useState(-1);
  const steps = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    // On narrow screens the sticky diagram covers the top half, so read the step under it.
    const narrow = window.matchMedia("(max-width: 900px)").matches;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.step);
          if (e.isIntersecting) setStage(i);
          else if (i === 0 && e.boundingClientRect.top > 0) setStage(-1);
        }
      },
      { rootMargin: narrow ? "-55% 0px -40% 0px" : "-45% 0px -45% 0px" },
    );
    for (const el of steps.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  const [btc, usdc] = STATUS[stage];

  return (
    <section id="how" className="journey">
      <div className="wrap">
        <div className="section-head" data-reveal>
          <div>
            <p className="eyebrow">How it works</p>
            <h2>Your Bitcoin never leaves Bitcoin.</h2>
          </div>
          <a className="link-rule" href={`${DOCS_URL}/introduction/how-writz-works`}>
            Read the details
          </a>
        </div>

        <div className="journey-grid">
          <ol className="journey-steps">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                data-step={i}
                data-active={stage === i}
                ref={(el) => {
                  steps.current[i] = el;
                }}
              >
                <div className="n">{i + 1}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>

          <div className="journey-stage">
            <div className="journey-card" data-stage={stage}>
              <JourneyDiagram />
              <dl className="journey-status">
                <div>
                  <dt>Your BTC</dt>
                  <dd>{btc}</dd>
                </div>
                <div>
                  <dt>Your USDC</dt>
                  <dd>{usdc}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <p className="assurance" data-reveal>
          At no point does Writz hold your Bitcoin, and if Writz ever disappeared, you could reclaim it alone once the
          timelock expires.
        </p>
      </div>
    </section>
  );
}

function JourneyDiagram() {
  return (
    <svg viewBox="0 0 560 400" role="img" aria-label="BTC locked on Bitcoin, a proof sent to Stellar, USDC sent to your wallet">
      <rect className="lane" x="0" y="0" width="560" height="184" rx="10" />
      <rect className="lane" x="0" y="216" width="560" height="184" rx="10" />
      <text className="lane-label" x="24" y="34">BITCOIN</text>
      <text className="lane-label" x="24" y="250">STELLAR</text>

      <line className="proof-path" x1="420" y1="178" x2="420" y2="276" />

      <g transform="translate(120 104)">
        <rect className="wallet" x="-38" y="-26" width="76" height="52" rx="8" />
        <text className="node-label" y="50">Your wallet</text>
      </g>
      <g transform="translate(120 304)">
        <rect className="wallet" x="-38" y="-26" width="76" height="52" rx="8" />
        <text className="node-label" y="50">Your wallet</text>
      </g>

      <g transform="translate(420 104)">
        <path className="shackle" d="M -15 -4 V -16 A 15 15 0 0 1 15 -16 V -4" />
        <rect className="lock-body" x="-28" y="-6" width="56" height="42" rx="7" />
        <text className="node-label" y="62">Bitcoin Script</text>
      </g>

      <g transform="translate(420 304)">
        <rect className="contract" x="-66" y="-26" width="132" height="52" rx="8" />
        <text className="contract-label" y="5">Writz contracts</text>
        <g className="verified" transform="translate(66 -26)">
          <circle r="12" />
          <path d="M -5 0 L -1.5 3.5 L 5 -3.5" />
        </g>
      </g>

      <g className="token proof">
        <rect x="-12" y="-12" width="24" height="24" rx="5" />
        <path d="M -5 0 L -1.5 3.5 L 5 -3.5" />
        <text x="22" y="5">Proof</text>
      </g>

      <g className="token usdc">
        <circle r="19" />
        <text y="7">$</text>
      </g>

      <g className="token btc">
        <circle r="19" />
        <text y="7">₿</text>
      </g>
    </svg>
  );
}
