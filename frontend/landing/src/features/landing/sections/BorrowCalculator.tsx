"use client";

import { useState } from "react";

const EXAMPLE_PRICE = 100_000;
// private-lend config: 150% minimum collateral, liquidation below 120%.
const MIN_COLLATERAL = 1.5;
const LIQUIDATION = 1.2;

const SHARES = [
  { label: "66%", ratio: MIN_COLLATERAL },
  { label: "50%", ratio: 2 },
  { label: "33%", ratio: 3 },
];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function BorrowCalculator() {
  const [btc, setBtc] = useState(0.5);
  const [ratio, setRatio] = useState(MIN_COLLATERAL);

  const borrow = (btc * EXAMPLE_PRICE) / ratio;
  const liqPrice = (EXAMPLE_PRICE * LIQUIDATION) / ratio;
  const room = 1 - liqPrice / EXAMPLE_PRICE;

  return (
    <div className="calc">
      <label className="calc-row" htmlFor="calc-btc">
        <span>Lock</span>
        <span className="mono">{btc.toFixed(2)} BTC</span>
      </label>
      <input
        id="calc-btc"
        type="range"
        min={0.05}
        max={2}
        step={0.05}
        value={btc}
        onChange={(e) => setBtc(Number(e.target.value))}
      />

      <div className="calc-row">
        <span>Borrow</span>
        <div className="calc-seg" role="radiogroup" aria-label="Share of your BTC value">
          {SHARES.map((s) => (
            <button
              key={s.label}
              type="button"
              role="radio"
              aria-checked={ratio === s.ratio}
              onClick={() => setRatio(s.ratio)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="figure">
        <span className="num">{usd.format(borrow)}</span>
        <span className="unit">in USDC</span>
      </div>

      <div className="calc-meter" aria-hidden="true">
        <div className="calc-room" style={{ width: `${room * 100}%` }} />
      </div>
      <div className="calc-legend">
        <span>
          Liquidation below <strong className="mono">{usd.format(liqPrice)}</strong>
        </span>
        <span>BTC can fall {Math.round(room * 100)}%</span>
      </div>
      <div className="sub">Example at {usd.format(EXAMPLE_PRICE)} per BTC. The app uses the live price.</div>
    </div>
  );
}
