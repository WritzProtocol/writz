"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { onToast, showToast, TOAST_MS, toastsHere, type Toast } from "@/lib/toast";
import { useMockWorld, usePrefersReducedMotion } from "@/components/ui/hooks";
import * as ui from "@/components/ui/styles";

const EXIT_MS = 220;

const LABEL_TONE: Partial<Record<Toast["tone"], string>> = { positive: "text-positive", warning: "text-warning", danger: "text-danger" };

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
      className="[--cut:14px] grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-1 gap-x-2 pt-[14px] pr-2 pb-1.5 pl-[22px] bg-surface-2 text-heading [box-shadow:inset_0_0_0_1px_var(--line-strong)] [clip-path:polygon(var(--cut)_0,100%_0,100%_100%,0_100%,0_calc(var(--cut)/var(--shear)))] pointer-events-auto animate-wz-toast-in data-[leaving=true]:animate-wz-toast-out data-[leaving=true]:pointer-events-none"
      data-tone={t.tone}
      data-leaving={leaving}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHeld(false)}
    >
      <p
        className={ui.cx(
          "inline-flex items-center gap-2 text-[13px] font-semibold before:w-1.5 before:h-[11px] before:bg-current before:-skew-x-16 before:flex-none",
          LABEL_TONE[t.tone],
        )}
      >
        {t.label}
      </p>
      <p className="col-span-full pr-[14px] text-[15px] leading-[1.45]">{t.text}</p>
      <Link href={t.link.href} className={ui.cx(ui.btn("text", "sm"), "col-1 [justify-self:start]")} onClick={leave}>
        {t.link.label}
      </Link>
      <button
        type="button"
        className="col-2 row-1 grid place-items-center size-11 -mt-3 -mb-2 p-0 border-none bg-transparent text-body cursor-pointer hover:text-heading"
        aria-label="Dismiss"
        onClick={leave}
      >
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
    <div
      className="fixed right-6 bottom-6 z-45 flex flex-col items-stretch gap-2 w-[min(400px,calc(100vw-48px))] pointer-events-none max-lg:right-4 max-lg:left-4 max-lg:bottom-[calc(64px+env(safe-area-inset-bottom)+12px)] max-lg:w-auto"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <Item key={t.id} t={t} onGone={gone} />
      ))}
    </div>
  );
}
