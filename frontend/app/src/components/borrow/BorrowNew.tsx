"use client";

import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/ui/hooks";
import { FocusJourney } from "./FocusJourney";
import { useShellAccount } from "@/components/shell/account";
import { SkBtn, T } from "@/components/ui/skeleton";
import { useLiveJourney } from "./useLiveJourney";
import { useMockJourney } from "./useMockJourney";

function LiveJourney() {
  return <FocusJourney m={useLiveJourney()} />;
}

function MockJourney({ world }: { world: MockWorld }) {
  return <FocusJourney m={useMockJourney(world)} />;
}

const ROWS = [
  ["You can borrow", "up to 2,000.00 USDC"],
  ["Release", "Writz co-signs the release when your loan is repaid."],
  ["Your way out", "If Writz is unavailable, you alone can reclaim after about 18 Jul 2027 (block 300,000)."],
  ["Network", "Bitcoin signet. Test funds only."],
];

/** The deposit journey at the layout of the step it will open on, until the client knows the wallets. */
function Skeleton() {
  return (
    <div className="bj">
      <h1 className="wz-sr">Loading the deposit</h1>
      <div aria-hidden="true">
        <div className="bj-progress" style={{ ["--bj-steps" as string]: 6 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        <div className="bj-stepline">
          <p>
            <T>Step 1 of 6 Amount</T>
          </p>
        </div>
        <div className="bj-sum" data-sk="past-amount">
          <div className="bj-sum-bar">
            <span className="bj-sum-vals">
              <span>
                <small>
                  <T>Locking</T>
                </small>
                <span className="mono">
                  <T>0.05000000 BTC</T>
                </span>
              </span>
              <span>
                <small>
                  <T>Borrow up to</T>
                </small>
                <span className="mono">
                  <T>2,000.00 USDC</T>
                </span>
              </span>
            </span>
            <span className="bj-sum-ctl">
              <SkBtn className="wz-btn-sm">Edit</SkBtn>
              <span className="bj-toggle" />
            </span>
          </div>
        </div>
        <p className="bj-q" data-sk="amount">
          <T>How much BTC do you want to lock?</T>
        </p>
        <p className="bj-q" data-sk="review">
          <T>Check everything, then send</T>
        </p>
        <p className="bj-q" data-sk="other">
          <T>Bitcoin is confirming your deposit</T>
        </p>
        <div className="bj-grid" data-aside="true" data-sk="amount">
          <div className="bj-col">
            <div className="bj-panel">
              <p className="wz-label">
                <T>Amount in BTC</T>
              </p>
              <div className="wz-field wz-sk-field" />
              <p className="wz-hint">
                <T>About 5,000,000 sats. Minimum 0.00100000 BTC.</T>
              </p>
              <dl className="bj-kv">
                {[
                  ["You can borrow up to", "2,000.00 USDC"],
                  ["Liquidated if BTC falls below", "$48,000"],
                  ["BTC price", "$60,000"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <T>{k}</T>
                    </dt>
                    <dd className="mono">
                      <T>{v}</T>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="wz-hint">
                <T>The liquidation price assumes you borrow the full amount. If Writz stops, you can reclaim your BTC alone after about 21 Jul 2027.</T>
              </p>
              <div className="bj-submit">
                <SkBtn>Continue</SkBtn>
              </div>
            </div>
          </div>
          <div className="bj-aside bj-need">
            <div className="bj-h2">
              <T>What you&apos;ll need</T>
            </div>
            <ul className="bj-ticks wz-sk-list">
              {["A Stellar wallet", "Xverse with test BTC", "About 70 minutes"].map((t) => (
                <li key={t}>
                  <i />
                  <b>
                    <T>{t}</T>
                  </b>
                  <span>
                    <T>To receive USDC and sign loan actions</T>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="bj-grid" data-aside="true" data-sk="review">
          <div className="bj-col">
            <div className="wz-stack">
              <dl className="bj-rows">
                <div>
                  <dt>
                    <T>You lock</T>
                  </dt>
                  <dd>
                    <span className="mono bj-big">
                      <T>0.05000000 BTC</T>
                    </span>
                    <small>
                      <T>plus a network fee of about 282 sats</T>
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>
                    <T>To your lock address</T>
                  </dt>
                  <dd>
                    <span className="mono bj-addr">
                      <T>tb1qlockaddressfixture0000000000000000000000000000000000000</T>
                    </span>
                    <div className="bj-tools">
                      <SkBtn className="wz-btn-sm">Copy address</SkBtn>
                      <span className="bj-more">
                        <span className="wz-btn wz-btn-text">
                          <T>What is this?</T>
                        </span>
                      </span>
                    </div>
                  </dd>
                </div>
                {ROWS.map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <T>{k}</T>
                    </dt>
                    <dd>
                      <T>{v}</T>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="bj-send">
                <p className="bj-key">
                  <T>Writz cannot recover your Bitcoin key. Keep its recovery phrase.</T>
                </p>
                <p className="wz-check">
                  <i className="wz-sk-check" />
                  <T>I understand my BTC stays locked until I repay and release it, or until block 300,000.</T>
                </p>
                <div className="wz-slide wz-sk-field" />
                <span className="wz-btn wz-btn-text">
                  <T>I already sent BTC</T>
                </span>
              </div>
            </div>
          </div>
          <div className="bj-aside bj-slab wz-sk-slab">
            <div className="bj-h2">
              <T>Your lock on Bitcoin</T>
            </div>
            <p>
              <T>A Bitcoin Script holds it, not a company.</T>
            </p>
            <div className="bj-frag">
              <span>
                <T>You lock</T>
              </span>
              <p className="mono">
                <T>0.05000000 BTC</T>
              </p>
              <ul className="bj-ticks wz-sk-list">
                <li>
                  <i />
                  <b>
                    <T>Now</T>
                  </b>
                  <span>
                    <T>Only your key and Writz&apos;s together can move BTC from this address.</T>
                  </span>
                </li>
                <li>
                  <i />
                  <b>
                    <T>After block 300,000</T>
                  </b>
                  <span>
                    <T>Your key alone can. That is about 21 Jul 2027.</T>
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="bj-grid" data-sk="other">
          <div className="bj-col">
            <div className="bj-panel">
              <p className="bj-count">
                <T>0 of 3</T>
              </p>
              <p className="wz-hint">
                <T>About 30 minutes left. Your progress is saved in this browser.</T>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BorrowNew() {
  const mounted = useMounted();
  const world = useMockWorld();
  const a = useShellAccount();
  if (!mounted || !a.walletsKnown) return <Skeleton />;
  return world ? <MockJourney world={world} /> : <LiveJourney />;
}
