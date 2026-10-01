"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import type { ErrorContext } from "@/lib/errors";

export function Spinner() {
  return <span className="wz-spin" aria-hidden="true" />;
}

export type Tone = "info" | "positive" | "warning" | "danger" | "neutral";

/** A status notice. Warning and danger always carry their word label, never colour alone. */
export function Notice({
  tone,
  label,
  children,
  actions,
  alert,
}: {
  tone: Tone;
  label?: string;
  children: ReactNode;
  actions?: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className="wz-note" data-tone={tone} role={alert ? "alert" : "status"}>
      {label ? <span className="wz-note-label">{label}</span> : null}
      <div>{children}</div>
      {actions ? <div className="wz-actions">{actions}</div> : null}
    </div>
  );
}

/** A mapped error inside a notice: headline, safety line, next step, raw text behind Technical details. */
export function ErrorBox({
  error,
  context,
  hash,
  label = "Something went wrong",
  tone = "danger",
  actions,
}: {
  error: unknown;
  context?: ErrorContext;
  hash?: string;
  label?: string;
  tone?: Tone;
  actions?: ReactNode;
}) {
  return (
    <div className="wz-note" data-tone={tone}>
      <span className="wz-note-label">{label}</span>
      <ErrorNotice error={error} context={context} hash={hash} className="" />
      {actions ? <div className="wz-actions">{actions}</div> : null}
    </div>
  );
}

export function ExternalLink({ href, children, className = "wz-link" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="wz-sr"> (opens in a new tab)</span>
    </a>
  );
}

const HANDLE = 52;
const ARM_MS = 5_000;

/**
 * Slide to confirm an irreversible action. Pointer: drag past 90% of the
 * track. Keyboard: Enter or Space arms it, a second press within 5 seconds
 * confirms, Escape or leaving the control disarms.
 */
export function SlideToConfirm({
  label,
  armedLabel,
  doneLabel,
  disabled,
  describedBy,
  onConfirm,
}: {
  label: string;
  armedLabel: string;
  doneLabel: string;
  disabled?: boolean;
  describedBy?: string;
  onConfirm: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState<{ start: number; max: number } | null>(null);
  const [done, setDone] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const maxX = () => (track.current ? track.current.clientWidth - HANDLE : 0);

  const finish = () => {
    setX(maxX());
    setArmed(false);
    setDone(true);
    onConfirm();
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || done || !track.current) return;
    setDrag({ start: e.clientX - x, max: maxX() });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    setX(Math.min(drag.max, Math.max(0, e.clientX - drag.start)));
  };
  const up = () => {
    if (!drag) return;
    if (x >= drag.max * 0.9) finish();
    else setX(0);
    setDrag(null);
  };
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || done) return;
    if (e.key === "Escape") {
      setArmed(false);
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (armed) finish();
    else setArmed(true);
  };

  const shown = done ? doneLabel : armed ? armedLabel : label;

  return (
    <div className="wz-slide" ref={track} data-disabled={disabled} data-done={done} data-armed={armed}>
      <span className="wz-slide-fill" style={{ width: x + HANDLE - 4 }} />
      <span className="wz-slide-label" aria-hidden="true">
        {shown}
      </span>
      <button
        type="button"
        className="wz-slide-handle"
        style={{ transform: `translateX(${x}px)`, transition: drag ? "none" : undefined }}
        aria-label={done ? doneLabel : `${label}. Press Enter twice to confirm.`}
        aria-describedby={describedBy}
        disabled={disabled || done}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        onClick={(e) => e.preventDefault()}
        onBlur={() => setArmed(false)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="wz-sr" aria-live="polite">
        {armed ? armedLabel : ""}
      </span>
    </div>
  );
}

/** m equal cells filled to n, with the count always available as text. */
export function ConfirmationSlots({ n, m }: { n: number; m: number }) {
  const filled = Math.min(n, m);
  return (
    <div
      className="wz-slots"
      style={{ ["--slots" as string]: m }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={m}
      aria-valuenow={filled}
      aria-valuetext={`${filled} of ${m} Bitcoin confirmations`}
    >
      {Array.from({ length: m }, (_, i) => (
        <span key={i} className="wz-slot" data-on={i < filled} />
      ))}
    </div>
  );
}
