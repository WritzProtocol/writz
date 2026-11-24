import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { formatUsdc } from "@/lib/borrow/journey";
import type { Read } from "@/lib/loan/model";
import { ExternalLink } from "@/components/ui";
import { Enter } from "@/components/ui/entrance";
import * as ui from "@/components/ui/styles";
import * as fu from "@/components/funds/styles";

const AMOUNT = {
  big: { figure: fu.bigFigure, unit: fu.bigUnit, na: fu.bigNa, sk: fu.bigSkeleton },
  tile: { figure: fu.tileFigure, unit: fu.tileUnit, na: fu.tileNa, sk: fu.tileSkeleton },
};

function Amount({
  value,
  unit,
  checking,
  decimals,
  size,
}: {
  value: Read<bigint>;
  unit: string;
  checking: string;
  decimals?: 2 | 7;
  size: keyof typeof AMOUNT;
}) {
  const c = AMOUNT[size];
  if (value.kind === "failed") return <span className={c.na}>Unavailable</span>;
  if (value.kind === "checking") {
    return (
      <>
        <span className={ui.cx(ui.skeleton, c.sk)} aria-hidden="true" />
        <span className="sr-only">{checking}</span>
      </>
    );
  }
  return (
    <>
      <span className={ui.cx("mono", c.figure)}>{formatUsdc(value.value, decimals)}</span> <span className={c.unit}>{unit}</span>
    </>
  );
}

/** The page's lead figure in the cut-corner panel; the size steps down as the number grows. */
export function Hero({
  label,
  value,
  unit,
  caption,
  decimals,
}: {
  label: string;
  value: Read<bigint> | { kind: "text"; text: string };
  unit: string;
  caption?: ReactNode;
  decimals?: 2 | 7;
}) {
  const digits = value.kind === "ok" ? formatUsdc(value.value, decimals).length : value.kind === "text" ? value.text.length : 8;
  return (
    <Enter name="hero" kind="open" className={ui.cx("cut", fu.hero)} style={{ "--n": Math.max(digits, 6), "--u": unit.length } as CSSProperties}>
      <dl>
        <dt className={fu.heroKey}>{label}</dt>
        <dd className={fu.big}>
          {value.kind === "text" ? (
            <>
              <span className={ui.cx("mono", fu.bigFigure)}>{value.text}</span> <span className={fu.bigUnit}>{unit}</span>
            </>
          ) : (
            <Amount value={value} unit={unit} checking="Checking..." decimals={decimals} size="big" />
          )}
        </dd>
        {caption ? <dd className={fu.heroCaption}>{caption}</dd> : null}
      </dl>
    </Enter>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return (
    <Enter as="dl" name="tiles" step={3} className={fu.tiles}>
      {children}
    </Enter>
  );
}

export function Tile({ label, value, unit = "USDC", caption }: { label: string; value: Read<bigint>; unit?: string; caption?: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={fu.tileValue}>
        <Amount value={value} unit={unit} checking="Checking..." size="tile" />
      </dd>
      {caption ? <dd className={fu.tileCaption}>{caption}</dd> : null}
    </div>
  );
}

/** The risk lines under the figures, each after the gold tick, then an optional docs link and the link to the pool or vault stats. */
export function RiskNotes({
  lines,
  docs,
  link,
}: {
  lines: ReactNode[];
  docs?: { href: string; label: string };
  link: { href: string; label: string };
}) {
  return (
    <Enter name="risk" step={4} className={fu.risk}>
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      {docs ? (
        <ExternalLink href={docs.href} className={fu.textLink}>
          {docs.label}
        </ExternalLink>
      ) : null}
      <Link href={link.href} className={fu.textLink}>
        {link.label}
      </Link>
    </Enter>
  );
}
