"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import type { ErrorContext } from "@/lib/errors";
import { endDrag, moveDrag, startDrag, type SlideDrag, type SlideEnd } from "./slideGesture";

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
  className,
}: {
  tone: Tone;
  label?: string;
  children: ReactNode;
  actions?: ReactNode;
  alert?: boolean;
  className?: string;
}) {
  return (
    <div className={className ? `wz-note ${className}` : "wz-note"} data-tone={tone} role={alert ? "alert" : "status"}>
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

const COPY_FAILED = "Couldn't copy. Select the address instead.";

/** Copies an address; "Copied" for 2 seconds, or the reason when the clipboard refuses. */
export function CopyButton({ value, className = "wz-btn wz-btn-line wz-btn-sm" }: { value: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  const copy = () => {
    const write = navigator.clipboard?.writeText(value);
    if (!write) return setState("failed");
    write.then(() => setState("copied")).catch(() => setState("failed"));
  };
  return (
    <>
      <button type="button" className={className} onClick={copy}>
        {state === "copied" ? "Copied" : "Copy address"}
      </button>
      <span className={state === "failed" ? "wz-hint wz-copy-fail" : "wz-sr"} aria-live="polite">
        {state === "copied" ? "Address copied" : state === "failed" ? COPY_FAILED : ""}
      </span>
    </>
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

const HANDLE = 76;
const END_GAP = 4;
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
  const dragRef = useRef<SlideDrag | null>(null);
  const pointer = useRef<number | null>(null);
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const [done, setDone] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const maxX = () => (track.current ? track.current.clientWidth - HANDLE - END_GAP : 0);

  const finish = () => {
    setX(maxX());
    setArmed(false);
    setDone(true);
    onConfirm();
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || done || !track.current || dragRef.current) return;
    dragRef.current = startDrag(e.clientX, x, maxX());
    pointer.current = e.pointerId;
    setDrag(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || e.pointerId !== pointer.current) return;
    dragRef.current = moveDrag(dragRef.current, e.clientX);
    setX(dragRef.current.x);
  };
  const end = (e: PointerEvent<HTMLButtonElement>, how: SlideEnd) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== pointer.current) return;
    dragRef.current = null;
    pointer.current = null;
    setDrag(false);
    const r = endDrag(d, how);
    if (r.confirm) finish();
    else setX(0);
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
      <span className="wz-slide-fill" style={{ width: x + HANDLE - 4, transition: drag ? "none" : undefined }} />
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
        onPointerUp={(e) => end(e, "up")}
        onPointerCancel={(e) => end(e, "cancel")}
        onLostPointerCapture={(e) => end(e, "cancel")}
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
      aria-label="Bitcoin confirmations"
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
