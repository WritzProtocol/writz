"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { onToast, showToast, TOAST_MS, toastsHere, type Toast } from "@/lib/toast";
import { useMockWorld, usePrefersReducedMotion } from "@/components/ui/hooks";

const EXIT_MS = 220;

function Item({ t, onGone }: { t: Toast; onGone: (id: number) => void }) {
  const reduced = usePrefersReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const [held, setHeld] = useState(false);

  const leave = () => {
    if (reduced) onGone(t.id);
    else setLeaving(true);
  };
  const leaveRef = useRef(leave);
  useEffect(() => {
    leaveRef.current = leave;
  });

  useEffect(() => {
    if (t.tone !== "positive" || held || leaving) return;
    const timer = setTimeout(() => leaveRef.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [t.tone, held, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onGone(t.id), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving, onGone, t.id]);

  return (
    <div
      className="wz-toast"
      data-tone={t.tone}
      data-leaving={leaving}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHeld(false)}
    >
      <p className="wz-toast-label">{t.label}</p>
      <p className="wz-toast-text">{t.text}</p>
      <Link href={t.link.href} className="wz-btn wz-btn-text wz-toast-link" onClick={leave}>
        {t.link.label}
      </Link>
      <button type="button" className="wz-toast-close" aria-label="Dismiss" onClick={leave}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** Harness only: two transactions that settle on other routes shortly after the page opens. */
function useMockSettles() {
  const world = useMockWorld();
  const on = Boolean(world?.globals.settledElsewhere);
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => {
      showToast({
        tone: "positive",
        label: "Done",
        text: "Borrowed 200.00 USDC on Loan 1. It's in your Stellar wallet.",
        origin: "/loans/1",
        link: { href: "/loans/1", label: "Open Loan 1" },
      });
      showToast({
        tone: "warning",
        label: "Not confirmed yet",
        text: "Your supply of 100.00 USDC was sent but isn't confirmed yet. It may still go through. Don't send it again.",
        origin: "/lend",
        link: { href: "/lend", label: "Open Lend" },
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [on]);
}

/** Results of transactions that settle while the user is on another route: bottom right, above the tabs on mobile. */
export function Toasts() {
  const pathname = usePathname();
  const [items, setItems] = useState<Toast[]>([]);
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);
  useEffect(
    () =>
      onToast((t) => {
        if (toastsHere(t.origin, path.current)) setItems((list) => [...list, t]);
      }),
    [],
  );
  useMockSettles();
  const gone = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  return (
    <div className="wz-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <Item key={t.id} t={t} onGone={gone} />
      ))}
    </div>
  );
}
