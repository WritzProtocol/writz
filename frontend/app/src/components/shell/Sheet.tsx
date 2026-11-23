"use client";

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/components/ui/hooks";

const EXIT_MS = 220;
const DISMISS_PX = 80;
const RETURN_MS = 320;
const BOTTOM_SHEET = "(max-width: 760px)";
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet: right side on desktop, bottom on mobile. Focus moves to the
 * heading, stays inside while open, and returns to the trigger on close.
 * A new `dismissOn` value closes it the same animated way, leaving focus to the page.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  returnFocus,
  dismissOn,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  returnFocus: React.RefObject<HTMLElement | null>;
  dismissOn?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const [closing, setClosing] = useState(false);
  const reduced = usePrefersReducedMotion();
  const restore = useRef(true);
  const drag = useRef<{ id: number; y: number; dy: number } | null>(null);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, reduced ? 0 : EXIT_MS);
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  const opened = useRef(dismissOn);
  useEffect(() => {
    if (dismissOn === opened.current) return;
    restore.current = false;
    closeRef.current();
  }, [dismissOn]);

  useEffect(() => {
    const trigger = returnFocus.current;
    heading.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!panel.current.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && (active === first || active === heading.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (restore.current) trigger?.focus();
    };
  }, [returnFocus]);

  const setOffset = (dy: number) => {
    const el = panel.current;
    if (el) el.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };
  const dragStart = (e: PointerEvent<HTMLElement>) => {
    const el = panel.current;
    if (closing || drag.current || !el || !e.isPrimary || !window.matchMedia(BOTTOM_SHEET).matches) return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    drag.current = { id: e.pointerId, y: e.clientY, dy: 0 };
    el.dataset.dragged = "true";
    delete el.dataset.returning;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const dragMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.dy = Math.max(0, e.clientY - d.y);
    setOffset(d.dy);
  };
  const dragEnd = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = drag.current;
    const el = panel.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    if (!cancelled && d.dy > DISMISS_PX) {
      close();
      return;
    }
    if (el && d.dy > 0 && !reduced) {
      el.dataset.returning = "true";
      setTimeout(() => delete el.dataset.returning, RETURN_MS);
    }
    setOffset(0);
  };
  const dragProps = {
    onPointerDown: dragStart,
    onPointerMove: dragMove,
    onPointerUp: (e: PointerEvent<HTMLElement>) => dragEnd(e, false),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => dragEnd(e, true),
  };

  return (
    <div className="group/sheet fixed inset-0 z-50 data-[closing=true]:pointer-events-none" data-closing={closing}>
      <div
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] animate-sh-fade group-data-[closing=true]/sheet:animate-sh-fade-out"
        onClick={close}
        aria-hidden="true"
      />
      <div
        ref={panel}
        className="absolute top-0 right-0 bottom-0 flex flex-col w-[min(400px,100vw)] border-l border-line-strong bg-surface overflow-y-auto overscroll-contain animate-sh-right group-data-[closing=true]/sheet:animate-sh-right-out max-[761px]:top-auto max-[761px]:left-0 max-[761px]:w-full max-[761px]:max-h-[90dvh] max-[761px]:border-l-0 max-[761px]:border-t max-[761px]:pb-[env(safe-area-inset-bottom)] max-[761px]:motion-safe:[animation-name:sh-up] max-[761px]:group-data-[closing=true]/sheet:[animation-name:sh-up-out] max-[761px]:data-[dragged=true]:group-data-[closing=false]/sheet:animate-none max-[761px]:data-[returning=true]:transition-[transform] max-[761px]:data-[returning=true]:duration-element max-[761px]:data-[returning=true]:ease-enter motion-reduce:transition-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <div
          className="sticky top-0 z-1 flex justify-between items-start gap-3 pt-5 px-5 pb-4 bg-surface border-b border-line max-[761px]:pt-6 max-[761px]:touch-none"
          {...dragProps}
        >
          <span className="hidden max-[761px]:block absolute top-2 left-1/2 w-10 h-1 -ml-5 bg-line-strong" aria-hidden="true" />
          <div>
            <h2 id={headingId} ref={heading} tabIndex={-1} className="text-[20px] font-semibold tracking-[-0.01em]">
              {title}
            </h2>
            {subtitle ? <p className="mt-1 text-[14px] text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="grid place-items-center size-11 -mt-2 -mr-[10px] border-none bg-transparent text-body cursor-pointer flex-none hover:text-heading"
            onClick={close}
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="pt-0 px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}
