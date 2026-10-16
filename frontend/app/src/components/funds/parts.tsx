import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { formatUsdc } from "@/lib/borrow/journey";
import type { Read } from "@/lib/loan/model";

function Amount({ value, unit, checking }: { value: Read<bigint>; unit: string; checking: string }) {
  if (value.kind === "failed") return <span className="fu-na">Unavailable</span>;
  if (value.kind === "checking") {
    return (
      <>
        <span className="wz-skeleton fu-sk" aria-hidden="true" />
        <span className="wz-sr">{checking}</span>
      </>
    );
  }
  return (
    <>
      <span className="mono">{formatUsdc(value.value)}</span> <span className="fu-unit">{unit}</span>
    </>
  );
}

/** The page's lead figure in the cut-corner panel; the size steps down as the number grows. */
export function Hero({
  label,
  value,
  unit,
  caption,
}: {
  label: string;
  value: Read<bigint> | { kind: "text"; text: string };
  unit: string;
  caption?: ReactNode;
}) {
  const digits = value.kind === "ok" ? formatUsdc(value.value).length : value.kind === "text" ? value.text.length : 8;
  return (
    <div className="fu-hero wz-cut" style={{ "--n": Math.max(digits, 6), "--u": unit.length } as CSSProperties}>
      <dl>
        <dt className="fu-hero-k">{label}</dt>
        <dd className="fu-big">
          {value.kind === "text" ? (
            <>
              <span className="mono">{value.text}</span> <span className="fu-unit">{unit}</span>
            </>
          ) : (
            <Amount value={value} unit={unit} checking="Checking..." />
          )}
        </dd>
        {caption ? <dd className="fu-caption">{caption}</dd> : null}
      </dl>
    </div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <dl className="fu-tiles">{children}</dl>;
}

export function Tile({ label, value, unit = "USDC", caption }: { label: string; value: Read<bigint>; unit?: string; caption?: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="fu-tile-v">
        <Amount value={value} unit={unit} checking="Checking..." />
      </dd>
      {caption ? <dd className="fu-caption">{caption}</dd> : null}
    </div>
  );
}

/** The risk lines under the figures, each after the gold tick, and the link to the pool or vault stats. */
export function RiskNotes({ lines, link }: { lines: ReactNode[]; link: { href: string; label: string } }) {
  return (
    <div className="fu-risk">
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      <Link href={link.href} className="wz-link fu-textlink">
        {link.label}
      </Link>
    </div>
  );
}
