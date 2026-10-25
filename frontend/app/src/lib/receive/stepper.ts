/**
 * Receiving as XLM or on Base Sepolia takes two transactions: step 1 borrows
 * USDC (the debt), step 2 swaps or sends it. Step 2 can fail or be skipped
 * without losing anything: the USDC stays in the borrower's wallet.
 */

export type LegState = "todo" | "running" | "done" | "failed" | "skipped";

/** Step 1 from the borrow flow. */
export type BorrowStep = "todo" | "running" | "done" | "failed";

export type SecondStep<Q = unknown> =
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "quoted"; quote: Q }
  | { kind: "signing" }
  | { kind: "done"; hash: string }
  | { kind: "failed"; error: unknown }
  | { kind: "skipped" };

export interface StepperView {
  steps: [LegState, LegState];
  /** The step the borrower acts on now; null when both are finished or step 1 failed. */
  active: 1 | 2 | null;
  /** Step 1 settled but step 2 did not: the USDC is in the wallet, offer to finish. */
  recovery: boolean;
}

function second(s: SecondStep): LegState {
  switch (s.kind) {
    case "idle":
    case "quoted":
      return "todo";
    case "quoting":
    case "signing":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
  }
}

export function stepperView(borrow: BorrowStep, leg: SecondStep): StepperView {
  if (borrow !== "done") {
    return { steps: [borrow, "todo"], active: borrow === "failed" ? null : 1, recovery: false };
  }
  const s = second(leg);
  return {
    steps: ["done", s],
    active: s === "done" ? null : 2,
    recovery: s === "failed" || s === "skipped",
  };
}
