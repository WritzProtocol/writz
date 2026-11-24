"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { useSigningReviews } from "@/lib/wallet/reviewsContext";
import { usdcText } from "@/lib/wallet/intent";
import type { ReviewAnswer, SigningReview, SigningReviews } from "@/lib/wallet/signingReview";
import * as ui from "@/components/ui/styles";

/** A ledger row stacked for the narrow notice: the term above its value. */
const signRow =
  "flex flex-wrap justify-between flex-col items-start gap-0.5 py-2 first:pt-0.5 border-t border-line-strong first:border-t-0 text-[15px] [&_dt]:shrink-0 [&_dt]:text-muted [&_dt]:text-[13px] [&_dd]:min-w-0 [&_dd]:m-0 [&_dd]:text-heading [&_dd]:text-left";

const NONE = () => () => {};
/** How long after mount the live region gets its text. */
export const LIVE_DELAY_MS = 100;

/** The waiting review and which slot shows it, kept in sync with the store. */
function useReviewState(reviews: SigningReviews | null): { review: SigningReview | null; owner: string | null } {
  const review = useSyncExternalStore(
    reviews ? (cb) => reviews.subscribe(cb) : NONE,
    () => reviews?.get() ?? null,
    () => null,
  );
  const owner = useSyncExternalStore(
    reviews ? (cb) => reviews.subscribe(cb) : NONE,
    () => reviews?.owner() ?? null,
    () => null,
  );
  return { review, owner };
}

interface Copy {
  tone: "danger" | "warning" | "info";
  label: string;
  headline: string;
  body: string;
  announce: string;
}

function copyOf(r: SigningReview): Copy {
  switch (r.mode) {
    case "mismatch":
      return {
        tone: "danger",
        label: "Stopped",
        headline: "This isn't the transaction you asked for",
        body: `Writz stopped it before ${r.walletName} signed. Nothing was signed or sent.`,
        announce: `Stopped. This isn't the transaction you asked for. Nothing was signed.`,
      };
    case "unknown":
      return {
        tone: "warning",
        label: "Can't check",
        headline: "Writz can't check this transaction",
        body: `Sign only if you started this yourself and know what it does. ${r.walletName} signs it with your key.`,
        announce: "Writz can't check this transaction. Cancel, or sign anyway.",
      };
    case "large": {
      const limit = r.limit !== null ? `${usdcText(r.limit)} USDC` : "your limit";
      return {
        tone: "info",
        label: "Large amount",
        headline: `${r.asked ?? "Sign this transaction"}?`,
        body: `It's more than ${limit}, so Writz asks once more before ${r.walletName} signs.`,
        announce: `Confirm: ${r.asked ?? "sign this transaction"}.`,
      };
    }
  }
}

/**
 * The signing check, inline where the action shows its progress. Focus moves
 * to it when it appears, Escape cancels, and its text is announced. A mismatch
 * offers only Cancel; an unrecognised transaction offers Cancel first and
 * Sign anyway second; a large amount offers Confirm and Cancel.
 */
export function SigningCheckView({ review, onAnswer }: { review: SigningReview; onAnswer: (a: ReviewAnswer) => void }) {
  const ref = useRef<HTMLElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const before = useRef<Element | null>(null);
  const uid = useId();
  const [answered, setAnswered] = useState<number | null>(null);
  const c = copyOf(review);
  const busy = answered === review.id;
  const announce = c.announce;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement && document.activeElement !== el && !el.contains(document.activeElement)) {
      before.current = document.activeElement;
    }
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: "nearest" });
    // The live region mounts empty and is filled a moment later, so screen
    // readers that only announce changes to an existing region still read it.
    const t = setTimeout(() => {
      if (live.current) live.current.textContent = announce;
    }, LIVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [review.id, announce]);

  const answer = (a: ReviewAnswer) => {
    if (busy) return;
    setAnswered(review.id);
    const back = before.current;
    onAnswer(a);
    // Once the check is gone, focus goes back to where it was, unless
    // something else (the next check, the next step) has taken it.
    setTimeout(() => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    }, 0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    answer("cancel");
  };

  const cancel = (gold: boolean) => (
    <button type="button" className={ui.btn(gold ? "gold" : "line")} onClick={() => answer("cancel")} disabled={busy}>
      Cancel
    </button>
  );

  return (
    <section
      ref={ref}
      className={ui.cx(
        ui.note(c.tone, "gap-2 py-[var(--note-py,16px)] px-[var(--note-px,18px)]"),
        "scroll-mt-24 scroll-mb-[calc(112px+env(safe-area-inset-bottom))] focus:outline-2 focus:outline-mark focus:outline-offset-2 focus:not-focus-visible:outline-[color:color-mix(in_srgb,var(--mark)_55%,transparent)] animate-wz-enter",
      )}
      data-tone={c.tone}
      data-mode={review.mode}
      tabIndex={-1}
      aria-labelledby={`${uid}-h`}
      aria-describedby={`${uid}-b`}
      onKeyDown={onKeyDown}
    >
      <span className={ui.noteLabel(c.tone)}>{c.label}</span>
      <p id={`${uid}-h`} className="text-[16px] font-semibold leading-[1.35] text-heading">
        {c.headline}
      </p>
      {review.mode !== "large" ? (
        <dl className="my-0.5">
          {review.asked ? (
            <div className={signRow}>
              <dt>You asked to</dt>
              <dd>{review.asked}</dd>
            </div>
          ) : null}
          <div className={signRow}>
            <dt>{review.mode === "mismatch" ? "It would instead" : "It would"}</dt>
            <dd>
              {review.actual.map((line, i) => (
                <span key={i} className="block wrap-break-word">
                  {line}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      ) : null}
      <p id={`${uid}-b`}>{c.body}</p>
      {review.detail ? (
        <details>
          <summary>Technical details</summary>
          <p>{review.detail}</p>
        </details>
      ) : null}
      <div className={ui.cx(ui.actions, "mt-2")}>
        {review.mode === "mismatch" ? (
          cancel(true)
        ) : review.mode === "unknown" ? (
          <>
            {cancel(true)}
            <button
              type="button"
              className={ui.btn("line")}
              onClick={() => answer("sign")}
              disabled={busy}
              aria-describedby={`${uid}-b`}
            >
              Sign anyway
            </button>
          </>
        ) : (
          <>
            <button type="button" className={ui.btn("gold")} onClick={() => answer("sign")} disabled={busy}>
              Confirm
            </button>
            {cancel(false)}
          </>
        )}
      </div>
      <p ref={live} className="sr-only" role={review.mode === "large" ? "status" : "alert"} />
    </section>
  );
}

/**
 * Where an action shows its progress, this shows the signing check instead
 * when one is waiting and this is the slot that owns it (the latest mounted);
 * otherwise it shows `children`.
 */
export function SigningCheckSlot({ children }: { children?: ReactNode }) {
  const reviews = useSigningReviews();
  const slot = useId();
  useEffect(() => {
    if (!reviews) return;
    reviews.registerSlot(slot);
    return () => reviews.unregisterSlot(slot);
  }, [reviews, slot]);
  const { review, owner } = useReviewState(reviews);
  if (reviews && review && owner === slot) {
    return <SigningCheckView key={review.id} review={review} onAnswer={(a) => reviews.answer(review.id, a)} />;
  }
  return <>{children}</>;
}

/** The shell's fallback: shows a waiting check only when no slot on the page can. */
export function SigningCheckFallback() {
  const reviews = useSigningReviews();
  const { review, owner } = useReviewState(reviews);
  if (!reviews || !review || owner !== null) return null;
  return (
    <div className="mb-6">
      <SigningCheckView key={review.id} review={review} onAnswer={(a) => reviews.answer(review.id, a)} />
    </div>
  );
}
