import { errorMessage, isSignatureRejected } from "@/lib/wallet/rejection";

export type ToastTone = "positive" | "warning" | "danger";

export interface Toast {
  id: number;
  tone: ToastTone;
  label: string;
  text: string;
  /** The route the transaction started on; the toast shows only away from it. */
  origin: string;
  link: { href: string; label: string };
}

/** Success toasts leave on their own; the others stay until dismissed. */
export const TOAST_MS = 6_000;

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let next = 1;

export function onToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showToast(t: Omit<Toast, "id">): void {
  const toast = { ...t, id: next++ };
  listeners.forEach((l) => l(toast));
}

/** Whether a settled transaction should toast here: only away from the route it started on. */
export function toastsHere(origin: string, pathname: string): boolean {
  return origin !== pathname;
}

export function currentRoute(): string {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

/**
 * What a transaction that started on `origin` reports when it ends: the success
 * sentence, "not confirmed yet" for a timeout, a failure line otherwise. A
 * declined signature says nothing, since the user was there to decline it.
 */
export function settleToast(
  origin: string,
  link: Toast["link"],
  outcome: { ok: true; text: string } | { ok: false; error: unknown; what: string },
): Omit<Toast, "id"> | null {
  if (outcome.ok) return { tone: "positive", label: "Done", text: outcome.text, origin, link };
  if (isSignatureRejected(outcome.error)) return null;
  if (/ConfirmationTimedOut/.test(errorMessage(outcome.error)))
    return {
      tone: "warning",
      label: "Not confirmed yet",
      text: `${outcome.what} was sent but isn't confirmed yet. It may still go through. Don't send it again.`,
      origin,
      link,
    };
  return { tone: "danger", label: "Didn't go through", text: `${outcome.what} didn't go through.`, origin, link };
}

export function notifySettled(...args: Parameters<typeof settleToast>): void {
  const t = settleToast(...args);
  if (t) showToast(t);
}
