/**
 * The one signing check waiting for the user, if any, and the places on the
 * page that can show it.
 *
 * The check runs inside `signTransaction`, which has no way to render, so it
 * publishes what it needs here and waits for the answer. The component that
 * shows it (`SigningCheck`) mounts where the action's own progress is shown:
 * every panel that renders "awaiting signature" holds a slot, and the shell
 * holds a fallback that is used only when no slot is on the page, so a check
 * can never wait unseen while the transaction lock is held.
 */

/** How the embedded Pollar wallet is named in the UI. */
export const POLLAR_WALLET_NAME = "Pollar";

export type ReviewMode =
  /** The transaction is not what the flow declared. Only Cancel. */
  | "mismatch"
  /** No declared intent, or one this build does not know. Cancel, or Sign anyway. */
  | "unknown"
  /** It matches, and moves more USDC than the configured limit. Confirm or Cancel. */
  | "large";

export type ReviewAnswer = "sign" | "cancel";

export interface SigningReview {
  id: number;
  mode: ReviewMode;
  /** What was asked, in plain words; null when nothing was declared. */
  asked: string | null;
  /** What the transaction would do, in plain words. */
  actual: string[];
  /** The verifier's reason, behind Technical details. */
  detail: string | null;
  /** The large-amount limit in stroops, for "large". */
  limit: bigint | null;
  walletName: string;
}

export type ReviewRequest = Omit<SigningReview, "id">;

export class SigningReviews {
  private current: { review: SigningReview; resolve: (a: ReviewAnswer) => void } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly slots: string[] = [];
  private nextId = 1;

  /** Shows `request` and resolves with the user's answer. A mismatch can only resolve "cancel". */
  request(request: ReviewRequest): Promise<ReviewAnswer> {
    this.cancel();
    const review: SigningReview = { ...request, id: this.nextId++ };
    return new Promise<ReviewAnswer>((resolve) => {
      this.current = { review, resolve };
      this.emit();
    });
  }

  /** Answers the review `id`; a stale id (one already answered or replaced) is ignored. */
  answer(id: number, answer: ReviewAnswer): void {
    const c = this.current;
    if (!c || c.review.id !== id) return;
    this.current = null;
    c.resolve(c.review.mode === "mismatch" ? "cancel" : answer);
    this.emit();
  }

  /** Cancels whatever is waiting, for a disconnect or a newer request. */
  cancel(): void {
    if (this.current) this.answer(this.current.review.id, "cancel");
  }

  get(): SigningReview | null {
    return this.current?.review ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A slot that can show the check mounted, under a key unique on the page; the latest one shows it. */
  registerSlot(id: string): void {
    if (this.slots.includes(id)) return;
    this.slots.push(id);
    this.emit();
  }

  unregisterSlot(id: string): void {
    const i = this.slots.indexOf(id);
    if (i < 0) return;
    this.slots.splice(i, 1);
    this.emit();
  }

  /** The slot that shows the check: the most recently mounted, or null for the shell's fallback. */
  owner(): string | null {
    return this.slots.length ? this.slots[this.slots.length - 1] : null;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
