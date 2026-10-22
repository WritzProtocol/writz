import type { CSSProperties } from "react";
import { SkBtn, T } from "@/components/ui/skeleton";

interface Figures {
  hero?: { label: string; value: string; unit: string };
  tiles: [string, string, string?][];
}

/** A funds page (Lend, Earn) at its loaded layout, with or without a connected wallet, until the client knows the wallet. */
export function FundsSkeleton({
  title,
  lede,
  wallet,
  nowallet,
  risk,
  link,
  tabs,
  field,
  hint,
  connect,
}: {
  title: string;
  lede: string;
  wallet: Figures;
  nowallet: Figures;
  risk: string[];
  link: string;
  tabs: [string, string];
  field: string;
  hint: string;
  connect: string;
}) {
  const figures = (f: Figures, when: "wallet" | "nowallet") => (
    <div className="fu-figures" data-sk={when}>
      {f.hero ? (
        <div className="fu-hero wz-cut" style={{ "--n": Math.max(f.hero.value.length, 6), "--u": f.hero.unit.length } as CSSProperties}>
          <dl>
            <dt className="fu-hero-k">
              <T>{f.hero.label}</T>
            </dt>
            <dd className="fu-big wz-sk-big">
              <span className="mono">
                <T>{f.hero.value}</T>
              </span>{" "}
              <span className="fu-unit">
                <T>{f.hero.unit}</T>
              </span>
            </dd>
          </dl>
        </div>
      ) : null}
      <dl className="fu-tiles">
        {f.tiles.map(([k, v, caption]) => (
          <div key={k}>
            <dt>
              <T>{k}</T>
            </dt>
            <dd className="fu-tile-v">
              <span className="mono">
                <T>{v}</T>
              </span>
            </dd>
            {caption ? (
              <dd className="fu-caption">
                <T>{caption}</T>
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
      <div className="fu-risk wz-sk-list">
        {risk.map((r) => (
          <p key={r}>
            <T>{r}</T>
          </p>
        ))}
        <span className="wz-link fu-textlink">
          <T>{link}</T>
        </span>
      </div>
    </div>
  );

  return (
    <div className="fu-page">
      <h1 className="wz-sr">{title}</h1>
      <div aria-hidden="true">
        <p className="fu-h1">
          <T>{title}</T>
        </p>
        <p className="fu-lede">
          <T>{lede}</T>
        </p>
      </div>
      <div className="fu-grid" aria-hidden="true">
        {figures(wallet, "wallet")}
        {figures(nowallet, "nowallet")}
        <div className="fu-act">
          <div className="wz-stack" data-sk="wallet">
            <div className="wz-seg fu-seg">
              <SkBtn>{tabs[0]}</SkBtn>
              <SkBtn>{tabs[1]}</SkBtn>
            </div>
            <div className="fu-panel">
              <div className="wz-stack">
                <div className="wz-stack" style={{ gap: 8 }}>
                  <p className="wz-label">
                    <T>{field}</T>
                  </p>
                  <div className="wz-field wz-sk-field" />
                  <p className="wz-hint">
                    <T>{hint}</T>
                  </p>
                </div>
                <div className="wz-actions">
                  <SkBtn>{tabs[0]}</SkBtn>
                </div>
              </div>
            </div>
          </div>
          <div className="wz-note" data-tone="neutral" data-sk="nowallet">
            <div>
              <p>
                <T>{connect}</T>
              </p>
            </div>
            <div className="wz-actions">
              <SkBtn>Connect Stellar wallet</SkBtn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
