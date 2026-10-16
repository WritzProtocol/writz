import type { ReactNode } from "react";

/** Placeholder text: invisible copy under a bar, so the bar takes the real line's size at every breakpoint. */
export function T({ children }: { children: ReactNode }) {
  return <span className="wz-sk-t">{children}</span>;
}

/** A button's parallelogram at the real button's size, without the label. */
export function SkBtn({ className = "", children, ...rest }: { className?: string; children: ReactNode; "data-sk"?: SkWhen }) {
  return (
    <span className={`wz-btn wz-sk-btn ${className}`} {...rest}>
      {children}
    </span>
  );
}

/** Which layout a skeleton part belongs to; the hint set before first paint picks one. */
export type SkWhen = "wallet" | "nowallet" | "loans" | "noloans" | "amount" | "past-amount" | "review" | "other";
