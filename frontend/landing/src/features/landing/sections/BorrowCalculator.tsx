"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

const EXAMPLE_PRICE = 100_000;
// writz-lend config: 150% minimum collateral, liquidation below 120%.
const MIN_COLLATERAL = 1.5;
const LIQUIDATION = 1.2;

const SHARES = [
  { label: "66%", ratio: MIN_COLLATERAL },
  { label: "50%", ratio: 2 },
  { label: "33%", ratio: 3 },
];

const usdc = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const MIN_BTC = 0.05;
const MAX_BTC = 2;

export function BorrowCalculator() {
  const [btc, setBtc] = useState(0.5);
  const [ratio, setRatio] = useState(MIN_COLLATERAL);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  const borrow = Math.floor(((btc * EXAMPLE_PRICE) / ratio) * 100) / 100;
  const liqPrice = (EXAMPLE_PRICE * LIQUIDATION) / ratio;
  const fall = Math.round((1 - liqPrice / EXAMPLE_PRICE) * 100);
  const btcLabel = `${btc.toFixed(8)} BTC`;

  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + SHARES.length) % SHARES.length;
    setRatio(SHARES[n].ratio);
    radios.current[n]?.focus();
  };

  return (
    <form className="calc" aria-label="What you could borrow" onSubmit={(e) => e.preventDefault()}>
      <div className="calc-r">
        <label htmlFor="calc-btc">Lock</label>
        <output className="v" htmlFor="calc-btc">
          {btcLabel}
        </output>
      </div>
      <input
        id="calc-btc"
        type="range"
        min={MIN_BTC}
        max={MAX_BTC}
        step={0.05}
        value={btc}
        style={{ "--p": (btc - MIN_BTC) / (MAX_BTC - MIN_BTC) } as CSSProperties}
        aria-valuetext={btcLabel}
        onChange={(e) => setBtc(Number(e.target.value))}
      />

      <div className="calc-r">
        <span id="calc-share">Borrow</span>
        <div className="seg" role="radiogroup" aria-labelledby="calc-share">
          {SHARES.map((s, i) => (
            <button
              key={s.label}
              ref={(el) => {
                radios.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={ratio === s.ratio}
              tabIndex={ratio === s.ratio ? 0 : -1}
              onClick={() => setRatio(s.ratio)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="calc-fig" aria-live="polite">
        <span className="v">{usdc.format(borrow)}</span> <span>USDC</span>
      </p>

      <div className="ctrack" aria-hidden="true" style={{ "--at": `${fall}%` } as CSSProperties}>
        <b />
      </div>
      <div className="calc-legend">
        <span>
          Liquidation below <b className="v">{usd.format(liqPrice)}</b>
        </span>
        <span>BTC can fall {fall}%</span>
      </div>
      <p className="sub">Example at {usd.format(EXAMPLE_PRICE)} per BTC. The app uses the live price.</p>
    </form>
  );
}
