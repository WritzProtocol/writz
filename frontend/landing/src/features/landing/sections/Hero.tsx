"use client";

import { useEffect, useState } from "react";
import { APP_ROUTE } from "../constants";
import { AssembleMark } from "./AssembleMark";

export function Hero() {
  const [assembled, setAssembled] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setAssembled(true), 400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <section className="hero">
      <div className="wrap hero-copy">
        <span className="status">Live on Stellar testnet</span>
        <h1>
          Lock Bitcoin. Borrow dollars.
          <br />
          Tell no one.
        </h1>
        <p className="lead">
          Get dollars without selling your Bitcoin. It stays locked on Bitcoin by a script, not
          with a company, and never becomes a wrapped token.
        </p>
        <div className="ctas">
          <a className="btn btn-gold" href={APP_ROUTE}>
            Open app
          </a>
          <a className="btn btn-line" href="#how">
            See how it works
          </a>
        </div>
        <p className="testnet-note">Testnet only: test BTC and test USDC, no real funds.</p>
      </div>

      <AssembleMark assembled={assembled} />

      <div className="wrap">
        <div className="strip">
          <div>
            <div className="k">No custodian</div>
            <div className="v">A Bitcoin Script holds it, not a company.</div>
          </div>
          <div>
            <div className="k">No wrapped token</div>
            <div className="v">Your native BTC stays on Bitcoin. Nothing is bridged.</div>
          </div>
          <div>
            <div className="k">Your way out</div>
            <div className="v">If Writz stops, you reclaim your BTC after the timelock.</div>
          </div>
        </div>
      </div>
    </section>
  );
}
