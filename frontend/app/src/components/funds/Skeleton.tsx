import type { CSSProperties } from "react";
import { SkBtn, T } from "@/components/ui/skeleton";
import * as ui from "@/components/ui/styles";

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
  docs,
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
  docs?: string;
  link: string;
  tabs: [string, string];
  field: string;
  hint: string;
  connect: string;
}) {
  const figures = (f: Figures, when: "wallet" | "nowallet") => (
    <div className="fu-figures" data-sk={when}>
      {f.hero ? (
        <div className="cut fu-hero" style={{ "--n": Math.max(f.hero.value.length, 6), "--u": f.hero.unit.length } as CSSProperties}>
          <dl>
            <dt className="fu-hero-k">
              <T>{f.hero.label}</T>
            </dt>
            <dd className="fu-big flex-nowrap items-end">
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
      <div className={ui.cx("fu-risk", ui.skList)}>
        {risk.map((r) => (
          <p key={r}>
            <T>{r}</T>
          </p>
        ))}
        {docs ? (
          <span className={ui.cx(ui.link, "fu-textlink")}>
            <T>{docs}</T>
          </span>
        ) : null}
        <span className={ui.cx(ui.link, "fu-textlink")}>
          <T>{link}</T>
        </span>
      </div>
    </div>
  );

  return (
    <div className="fu-page">
      <h1 className="sr-only">{title}</h1>
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
          <div className={ui.stack} data-sk="wallet">
            <div className={ui.cx(ui.seg, "fu-seg")}>
              <SkBtn kind="seg">{tabs[0]}</SkBtn>
              <SkBtn kind="seg">{tabs[1]}</SkBtn>
            </div>
            <div className="fu-panel">
              <div className={ui.stack}>
                <div className={ui.stack} style={{ gap: 8 }}>
                  <p className={ui.label}>
                    <T>{field}</T>
                  </p>
                  <div className={ui.field("md", { skeleton: true })} />
                  <p className={ui.hint}>
                    <T>{hint}</T>
                  </p>
                </div>
                <div className={ui.actions}>
                  <SkBtn>{tabs[0]}</SkBtn>
                </div>
              </div>
            </div>
          </div>
          <div className={ui.note("neutral")} data-tone="neutral" data-sk="nowallet">
            <div>
              <p>
                <T>{connect}</T>
              </p>
            </div>
            <div className={ui.cx(ui.actions, "mt-1.5")}>
              <SkBtn>Connect Stellar wallet</SkBtn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
