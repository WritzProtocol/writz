"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import type { ErrorContext } from "@/lib/errors";
import { endDrag, moveDrag, startDrag, type SlideDrag, type SlideEnd } from "./slideGesture";
import * as ui from "@/components/ui/styles";

export function Spinner() {
  return <span className={ui.spin} aria-hidden="true" />;
}

import type { Tone } from "./styles";

export type { Tone };

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
    <div className={ui.cx(ui.note(tone), className)} data-tone={tone} role={alert ? "alert" : "status"}>
      {label ? <span className={ui.noteLabel(tone)}>{label}</span> : null}
      <div>{children}</div>
      {actions ? (
        <div className={ui.cx(ui.actions, "mt-1.5")} data-slot="actions">
          {actions}
        </div>
      ) : null}
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
  className,
}: {
  error: unknown;
  context?: ErrorContext;
  hash?: string;
  label?: string;
  tone?: Tone;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={ui.cx(ui.note(tone), className)} data-tone={tone}>
      <span className={ui.noteLabel(tone)}>{label}</span>
      <ErrorNotice error={error} context={context} hash={hash} className="" />
      {actions ? (
        <div className={ui.cx(ui.actions, "mt-1.5")} data-slot="actions">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

const COPY_FAILED = "Couldn't copy. Select the address instead.";

/** Copies an address; "Copied" for 2 seconds, or the reason when the clipboard refuses. */
export function CopyButton({ value, className = ui.btn("line", "sm") }: { value: string; className?: string }) {
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
      <span className={state === "failed" ? ui.cx(ui.hint, "basis-full") : "sr-only"} aria-live="polite">
        {state === "copied" ? "Address copied" : state === "failed" ? COPY_FAILED : ""}
      </span>
    </>
  );
}

export function ExternalLink({ href, children, className = ui.link }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
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
  className,
  labelClassName,
}: {
  label: string;
  armedLabel: string;
  doneLabel: string;
  disabled?: boolean;
  describedBy?: string;
  onConfirm: () => void;
  /** Restyles the track and its label in a context, such as the journey's review panel. */
  className?: string;
  labelClassName?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragRef = useRef<SlideDrag | null>(null);
  const pointer = useRef<number | null>(null);
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const [span, setSpan] = useState(0);
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
    setSpan(dragRef.current.max);
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
    <div
      className={ui.cx(ui.slide, "group/slide data-[armed=true]:[box-shadow:inset_0_0_0_2px_var(--accent)]", className)}
      ref={track}
      data-disabled={disabled}
      data-done={done}
      data-armed={armed}
      data-dragging={drag}
      style={{ "--slide-p": span > 0 ? x / span : 0 } as CSSProperties}
    >
      <span
        className="absolute inset-y-0 left-0 right-auto bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] group-data-[done=true]/slide:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] transition-[width] duration-element ease-exit group-data-[done=true]/slide:ease-enter motion-reduce:transition-none"
        style={{ width: x + HANDLE - 4, transition: drag ? "none" : undefined }} />
      <span
        className={ui.cx(
          "wz-slide-label absolute inset-y-0 right-4 left-[84px] grid place-items-center text-center font-medium text-[15px] leading-[1.2] text-heading group-data-[disabled=true]/slide:text-muted pointer-events-none opacity-[calc(1-var(--slide-p,0)*1.4)] group-data-[done=true]/slide:opacity-100 transition-opacity duration-element ease-exit group-data-[dragging=true]/slide:transition-none motion-reduce:transition-none",
          labelClassName,
        )}
        aria-hidden="true"
      >
        {shown}
      </span>
      <button
        type="button"
        className="absolute top-1 left-1 isolate grid place-items-center w-[72px] h-14 p-0 border-none bg-transparent text-on-accent group-data-[disabled=true]/slide:text-muted cursor-grab active:cursor-grabbing disabled:cursor-not-allowed touch-manipulation transition-[transform] duration-element ease-exit group-data-[done=true]/slide:ease-enter motion-reduce:transition-none focus-visible:outline-none before:absolute before:inset-y-0 before:inset-x-2 before:-z-1 before:bg-accent group-data-[disabled=true]/slide:before:bg-tint-20 before:-skew-x-16 focus-visible:before:[box-shadow:0_0_0_2px_var(--bg),0_0_0_4px_var(--mark)]"
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
      <span className="sr-only" aria-live="polite">
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
      className="wz-slots grid grid-cols-[repeat(var(--slots,6),1fr)] gap-1"
      style={{ ["--slots" as string]: m }}
      role="progressbar"
      aria-label="Bitcoin confirmations"
      aria-valuemin={0}
      aria-valuemax={m}
      aria-valuenow={filled}
      aria-valuetext={`${filled} of ${m} Bitcoin confirmations`}
    >
      {Array.from({ length: m }, (_, i) => (
        <span
          key={i}
          className="wz-slot h-11 bg-[color-mix(in_srgb,var(--deep)_55%,transparent)] data-[on=true]:bg-accent transition-[background-color] duration-element ease-linear motion-reduce:transition-none"
          data-on={i < filled}
        />
      ))}
    </div>
  );
}
