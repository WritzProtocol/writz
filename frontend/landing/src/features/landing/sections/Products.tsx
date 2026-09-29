import { APP_ROUTE } from "../constants";

export function Products() {
  return (
    <section id="products" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head" data-reveal>
          <div>
            <p className="eyebrow">Two ways in</p>
            <h2>Put dollars to work, or put Bitcoin to work.</h2>
          </div>
        </div>
        <div className="products">
          <div className="product earn" id="earn" data-reveal>
            <div className="k">Earn</div>
            <h3>
              Lend dollars.
              <br />
              Earn on them.
            </h3>
            <p>Deposit USDC and earn yield that accrues on its own. Withdraw part or all of it whenever you want.</p>
            <div className="figure">
              <span className="num">APY</span>
              <span className="unit">from borrower interest</span>
            </div>
            <div className="sub">Variable, shown live in the app.</div>
            <div className="foot">
              <a className="btn btn-line" href={APP_ROUTE}>
                Start earning
              </a>
              <span className="note">No lock-up</span>
            </div>
          </div>

          <div className="product borrow" id="borrow" data-reveal>
            <div className="k">Borrow</div>
            <h3>
              Keep your Bitcoin.
              <br />
              Spend anyway.
            </h3>
            <p>Lock your Bitcoin, take dollars against it, and get it back when you repay.</p>
            <div className="figure">
              <span className="num">66%</span>
              <span className="unit">of your BTC value</span>
            </div>
            <div className="sub">Variable interest, repay anytime. Below 120% collateral, it can be liquidated.</div>
            <div className="foot">
              <a className="btn btn-ink" href={APP_ROUTE}>
                Start borrowing
              </a>
              <span className="note">No wrapped token</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
