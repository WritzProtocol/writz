import type { ReactNode } from "react";
import { describeError, type ErrorContext } from "@/lib/errors";
import { GITHUB_ISSUES_URL } from "@/lib/links";

const MAX_DETAIL = 2000;

const LINK = "underline decoration-current/40 underline-offset-2 hover:opacity-80";

/** A failure as headline, safety line and next step, with the raw error behind "Technical details". */
export function ErrorNotice({
  error,
  context,
  className = "text-xs text-crit",
  hash,
  children,
}: {
  error: unknown;
  context?: ErrorContext;
  className?: string;
  hash?: string;
  children?: ReactNode;
}) {
  const e = describeError(error, context);
  const details = [
    e.contract && `Contract error: ${e.contract.contract} #${e.contract.code}${e.contract.variant ? ` (${e.contract.variant})` : ""}`,
    hash && `Transaction: ${hash}`,
    e.raw.length > MAX_DETAIL ? `${e.raw.slice(0, MAX_DETAIL)}…` : e.raw,
  ].filter(Boolean);

  return (
    <div role="alert" className="flex flex-col gap-1">
      <p className={className}>
        {[e.headline, e.safety, e.action].filter(Boolean).join(" ")}
        {e.report ? (
          <>
            {" "}
            {e.report === "if_repeats" ? "If it keeps happening, " : null}
            <a href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
              {e.report === "if_repeats" ? "report it on GitHub" : "Report it on GitHub"}
            </a>
            .
          </>
        ) : null}
        {e.link ? (
          <>
            {" "}
            <a href={e.link.href} target="_blank" rel="noopener noreferrer" className={LINK}>
              {e.link.label}
            </a>
          </>
        ) : null}
        {children ? <> {children}</> : null}
      </p>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none">Technical details</summary>
        {details.map((line, i) => (
          <p key={i} className="mt-1 break-all font-mono">
            {line}
          </p>
        ))}
      </details>
    </div>
  );
}
