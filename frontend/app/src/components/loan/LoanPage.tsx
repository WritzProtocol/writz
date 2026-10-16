"use client";

import type { LoanTab } from "@/lib/loan/model";
import type { MockWorld } from "@/lib/mock/types";
import { useMounted, useMockWorld } from "@/components/ui/hooks";
import { LoanView } from "./LoanView";
import { HealthMeter } from "./parts";
import { useShellAccount } from "@/components/shell/account";
import { SkBtn, T } from "@/components/ui/skeleton";
import { useLiveLoan } from "./useLiveLoan";
import { useMockLoan } from "./useMockLoan";

function LiveLoan({ n, panel }: { n: number; panel: LoanTab | null }) {
  return <LoanView m={useLiveLoan(n, panel)} />;
}

function MockLoan({ world, n }: { world: MockWorld; n: number }) {
  return <LoanView m={useMockLoan(world, n)} />;
}

const GRID = { ["--ln-areas" as string]: '"risk nums" "acts side"' };

/** The loan page at its loaded layout until the client knows the wallet; without a remembered wallet, the connect panel. */
function Skeleton({ n }: { n: number }) {
  return (
    <>
      <h1 className="wz-sr">Loading Loan {n}</h1>
      <div className="ln-col" aria-hidden="true">
        <div className="ln-head">
          <div className="ln-title">
            <p className="ln-h1">
              <T>Loan {n}</T>
            </p>
            <SkBtn className="wz-badge" data-sk="wallet">
              Healthy
            </SkBtn>
          </div>
          <p className="ln-sub" data-sk="wallet">
            <T>Opened 11 Oct 2026. </T>
            <span className="mono">
              <T>0.05000000</T>
            </span>
            <T> BTC locked.</T>
          </p>
        </div>
        <div className="ln-empty wz-cut-sm" data-sk="nowallet">
          <p>
            <T>Connect your Stellar wallet to see this loan. It receives your USDC and signs loan actions.</T>
          </p>
          <SkBtn>Connect Stellar wallet</SkBtn>
        </div>
        <div className="ln-grid" style={GRID} data-sk="wallet">
          <div className="ln-risk wz-cut">
            <p className="ln-ratio">
              <b className="mono">
                <T>200%</T>
              </b>
              <span>
                <T>Healthy</T>
              </span>
            </p>
            <HealthMeter ratioBp={null} health={null} />
            <p className="ln-liq">
              <T>Liquidated if BTC falls below $36,000. BTC now $60,000 (oracle price).</T>
            </p>
          </div>
          <dl className="ln-nums">
            {[
              ["Collateral", "0.05000000 BTC", "at $60,000 per BTC"],
              ["You owe", "1,500.00 USDC"],
              ["Available to borrow", "500.00 USDC"],
            ].map(([k, v, small]) => (
              <div key={k}>
                <dt>
                  <T>{k}</T>
                </dt>
                <dd>
                  <T>{v}</T>
                  {small ? (
                    <small>
                      <T>{small}</T>
                    </small>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
          <div className="ln-actions">
            <div className="wz-seg">
              {["Borrow more", "Repay", "Release BTC"].map((t) => (
                <SkBtn key={t}>
                  {t}
                </SkBtn>
              ))}
            </div>
            <ul className="ln-reasons">
              <li>
                <T>Repay the loan first, then release your BTC.</T>
              </li>
            </ul>
            <div className="ln-panel ln-act-panel">
              <div className="wz-stack">
                <div className="wz-stack" style={{ gap: 8 }}>
                  <p className="wz-label">
                    <T>Borrow</T>
                  </p>
                  <div className="wz-field ln-field wz-sk-field" />
                  <p className="wz-hint">
                    <T>You can borrow up to 500.00 USDC more.</T>
                  </p>
                </div>
                <div className="wz-chips ln-presets">
                  <SkBtn className="wz-chip">25%</SkBtn>
                  <SkBtn className="wz-chip">50%</SkBtn>
                </div>
                <p className="ln-after">
                  <T>After: 200% ratio.</T>
                </p>
                <div>
                  <SkBtn>Borrow</SkBtn>
                </div>
              </div>
            </div>
          </div>
          <div className="ln-side">
            <div className="ln-out wz-cut-sm">
              <div className="ln-h2">
                <T>Your way out</T>
              </div>
              <p className="ln-out-text">
                <T>If Writz stops, you can reclaim this BTC with your Bitcoin key alone after block 300,000, about 21 Jul 2027. </T>
                <span className="wz-btn wz-btn-text ln-out-link">
                  <T>How to reclaim</T>
                </span>
              </p>
              <div className="ln-out-track" />
              <div className="ln-out-ends">
                <T>Opened 11 Oct 2026</T>
                <T>Block 300,000</T>
              </div>
            </div>
            <div className="ln-device">
              <div className="ln-h2">
                <T>On this device</T>
              </div>
              <p>
                <T>No transactions for this loan on this device yet.</T>
              </p>
              <p className="wz-muted">
                <T>Full history needs the Writz indexer and is coming later.</T>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function LoanPage({ n, panel }: { n: number; panel: LoanTab | null }) {
  const mounted = useMounted();
  const world = useMockWorld();
  const a = useShellAccount();
  if (!mounted || !a.walletsKnown) return <Skeleton n={n} />;
  return world ? <MockLoan world={world} n={n} /> : <LiveLoan n={n} panel={panel} />;
}
