import type { ReactNode } from "react";
import * as ui from "./styles";

/** Placeholder text: invisible copy under a bar, so the bar takes the real line's size at every breakpoint. */
export function T({ children }: { children: ReactNode }) {
  return <span className={ui.skText}>{children}</span>;
}

/** A button's parallelogram at the real button's size, without the label. */
export function SkBtn({ kind = "btn", children, ...rest }: { kind?: ui.SkKind; children: ReactNode; "data-sk"?: SkWhen }) {
  return (
    <span className={ui.skBtn(kind)} {...rest}>
      {children}
    </span>
  );
}

/** Which layout a skeleton part belongs to; the hint set before first paint picks one. */
export type SkWhen = "wallet" | "nowallet" | "loans" | "noloans" | "amount" | "past-amount" | "review" | "other";
