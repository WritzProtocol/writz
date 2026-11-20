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
 *
 * Requests queue, first in first out, and the page shows one at a time. Two
 * signing calls can overlap: the swap and the cross-chain send of step 2 do
 * not take the transaction lock, and two tabs or a double click can race. A
 * newer request therefore never cancels an older one, which would surface as
 * "you declined" for a signature the user was never asked about; each waits
 * for its own answer, in order.
 *
 * Which panel shows the check: the most recently mounted slot. A signing call
 * does not know which panel started it, so this is a heuristic, not a link.
 * It holds in practice because the transaction lock lets one flow per account
 * sign at a time and the panel of the running flow is the one that just
 * switched to its progress view (and mounted its slot); the fallback covers
 * the rest. Tying a request to its panel would mean threading a slot id
 * through every flow, which is not done here.
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
  private readonly queue: { review: SigningReview; resolve: (a: ReviewAnswer) => void }[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly slots: string[] = [];
  private nextId = 1;

  /**
   * Queues `request` behind any waiting one and resolves with the user's
   * answer once it has been shown and answered. A mismatch can only resolve
   * "cancel".
   */
  request(request: ReviewRequest): Promise<ReviewAnswer> {
    const review: SigningReview = { ...request, id: this.nextId++ };
    return new Promise<ReviewAnswer>((resolve) => {
      this.queue.push({ review, resolve });
      if (this.queue.length === 1) this.emit();
    });
  }

  /** Answers the review on screen, `id`; any other id (answered, or still queued) is ignored. */
  answer(id: number, answer: ReviewAnswer): void {
    const head = this.queue[0];
    if (!head || head.review.id !== id) return;
    this.queue.shift();
    head.resolve(head.review.mode === "mismatch" ? "cancel" : answer);
    this.emit();
  }

  /** Cancels every waiting review, for a disconnect. */
  cancel(): void {
    const waiting = this.queue.splice(0);
    for (const w of waiting) w.resolve("cancel");
    if (waiting.length) this.emit();
  }

  /** How many requests wait behind the one on screen. */
  queued(): number {
    return Math.max(0, this.queue.length - 1);
  }

  get(): SigningReview | null {
    return this.queue[0]?.review ?? null;
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
