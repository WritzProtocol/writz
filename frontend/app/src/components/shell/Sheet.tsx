"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/components/ui/hooks";

const EXIT_MS = 220;
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

  return (
    <div className="sh-root" data-closing={closing}>
      <div className="sh-backdrop" onClick={close} aria-hidden="true" />
      <div ref={panel} className="sh-panel" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <span className="sh-handle" aria-hidden="true" />
        <div className="sh-head">
          <div>
            <h2 id={headingId} ref={heading} tabIndex={-1} className="sh-title">
              {title}
            </h2>
            {subtitle ? <p className="sh-sub">{subtitle}</p> : null}
          </div>
          <button type="button" className="sh-close" onClick={close} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="sh-body">{children}</div>
      </div>
    </div>
  );
}
