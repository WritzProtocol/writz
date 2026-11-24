import { APP_ROUTE } from "../constants";
import * as l from "../styles";

export function Products() {
  return (
    <section className={l.products} aria-labelledby="prod-h">
      <div className={l.wrap}>
        <h2 id="prod-h" className={l.productsHeading} data-reveal>
          Put dollars to work, or put Bitcoin to work.
        </h2>
        <div className={l.tiles}>
          <article className={l.tile(false)} id="borrow" data-reveal>
            <h3>Keep your Bitcoin. Spend anyway.</h3>
            <p className={l.tileText}>Lock your Bitcoin, take dollars against it, and get it back when you repay.</p>
            <div className={l.offer}>
              <p className={l.big}>
                <b>66%</b> of your BTC value, at most
              </p>
              <dl className={l.terms}>
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
            <p className={l.offerSub}>Borrowing less leaves more room before liquidation.</p>
            <div className={l.tileFoot}>
              <a className={l.btn("gold")} href={APP_ROUTE} data-umami-event="start-borrowing" data-umami-event-where="products">
                Start borrowing
              </a>
              <span>No wrapped token</span>
            </div>
          </article>

          <article className={l.tile(true)} id="lend" data-reveal>
            <h3>Lend dollars. Earn on them.</h3>
            <p className={l.tileText}>Supply USDC to the pool Bitcoin borrowers draw from. Interest accrues on its own, and you withdraw whatever is not lent out at that moment.</p>
            <p className={l.big}>
              <b>APR</b> from borrower interest
            </p>
            <p className={l.sub}>Variable, shown live in the app.</p>
            <div className={l.tileFoot}>
              <a className={l.btn()} href={`${APP_ROUTE.replace(/\/$/, "")}/lend`} data-umami-event="start-lending" data-umami-event-where="products">
                Start lending
              </a>
              <span>No lock-up</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
