import { APP_ROUTE } from "../constants";

export function Products() {
  return (
    <section className="prod" aria-labelledby="prod-h">
      <div className="wrap">
        <h2 id="prod-h" data-reveal>
          Put dollars to work, or put Bitcoin to work.
        </h2>
        <div className="tiles">
          <article className="tile borrow" id="borrow" data-reveal>
            <h3>Keep your Bitcoin. Spend anyway.</h3>
            <p>Lock your Bitcoin, take dollars against it, and get it back when you repay.</p>
            <div className="offer">
              <p className="big">
                <b>66%</b> of your BTC value, at most
              </p>
              <dl className="terms">
                <div>
                  <dt>Liquidation</dt>
                  <dd>If your collateral falls below 120% of the loan</dd>
                </div>
                <div>
                  <dt>Your way out</dt>
                  <dd>If Writz stops, you reclaim your BTC after the timelock</dd>
                </div>
              </dl>
            </div>
            <p className="sub">Borrowing less leaves more room before liquidation.</p>
            <div className="tfoot">
              <a className="btn btn-gold" href={APP_ROUTE}>
                Start borrowing
              </a>
              <span>No wrapped token</span>
            </div>
          </article>

          <article className="tile earn" id="earn" data-reveal>
            <h3>Lend dollars. Earn on them.</h3>
            <p>Deposit USDC and earn yield that accrues on its own. Withdraw part or all of it whenever you want.</p>
            <p className="big">
              <b>APY</b> from borrower interest
            </p>
            <p className="sub">Variable, shown live in the app.</p>
            <div className="tfoot">
              <a className="btn" href={APP_ROUTE}>
                Start earning
              </a>
              <span>No lock-up</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
