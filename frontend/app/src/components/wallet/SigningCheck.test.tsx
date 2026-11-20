import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { ReviewsContext } from "@/lib/wallet/reviewsContext";
import { SigningReviews, type ReviewAnswer, type ReviewRequest, type SigningReview } from "@/lib/wallet/signingReview";
import { LIVE_DELAY_MS, SigningCheckFallback, SigningCheckSlot, SigningCheckView } from "./SigningCheck";

// A DOM for this file only, so focus and keyboard can be exercised; removed again after.
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(node: ReactNode): Promise<HTMLElement> {
  const { createRoot } = await import("react-dom/client");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const REQUESTS: Record<SigningReview["mode"], ReviewRequest> = {
  mismatch: {
    mode: "mismatch",
    asked: "Deposit 10.00 USDC into the Earn vault",
    actual: ["Send 500.00 USDC to GBRP…7KQZ"],
    detail: "wrong_contract: calls a contract other than the Earn vault",
    limit: null,
    walletName: "Pollar",
  },
  unknown: {
    mode: "unknown",
    asked: null,
    actual: ["Call claim on contract CDLZ…CYSC"],
    detail: "no intent declared",
    limit: null,
    walletName: "Pollar",
  },
  large: {
    mode: "large",
    asked: "Deposit 25,000.00 USDC into the Earn vault",
    actual: ["Deposit into the Earn vault"],
    detail: null,
    limit: 10_000_0000000n,
    walletName: "Pollar",
  },
};

const view = (mode: SigningReview["mode"], onAnswer: (a: ReviewAnswer) => void = () => {}) =>
  render(<SigningCheckView review={{ ...REQUESTS[mode], id: 1 }} onAnswer={onAnswer} />);

const buttons = (el: HTMLElement) => [...el.querySelectorAll("button")].map((b) => b.textContent);
const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ");

function press(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("SigningCheckView", () => {
  test("mismatch: says what was asked and what it would do, and offers only Cancel", async () => {
    const answers: ReviewAnswer[] = [];
    const el = await view("mismatch", (a) => answers.push(a));
    expect(text(el)).toContain("This isn't the transaction you asked for");
    const rows = [...el.querySelectorAll(".wz-row")].map((r) => [r.querySelector("dt")?.textContent, r.querySelector("dd")?.textContent]);
    expect(rows).toEqual([
      ["You asked to", "Deposit 10.00 USDC into the Earn vault"],
      ["It would instead", "Send 500.00 USDC to GBRP…7KQZ"],
    ]);
    expect(text(el)).toContain("Nothing was signed or sent.");
    expect(buttons(el)).toEqual(["Cancel"]);
    await act(async () => (el.querySelector("button") as HTMLButtonElement).click());
    expect(answers).toEqual(["cancel"]);
  });

  test("unknown: Cancel first as the primary action, Sign anyway second and described by the warning", async () => {
    const answers: ReviewAnswer[] = [];
    const el = await view("unknown", (a) => answers.push(a));
    expect(buttons(el)).toEqual(["Cancel", "Sign anyway"]);
    const [cancel, risk] = [...el.querySelectorAll("button")];
    expect(cancel.className).toContain("wz-btn-gold");
    expect(risk.className).toContain("wz-btn-line");
    const warning = document.getElementById(risk.getAttribute("aria-describedby")!);
    expect(warning?.textContent).toContain("Sign only if you started this yourself");
    await act(async () => risk.click());
    expect(answers).toEqual(["sign"]);
  });

  test("large amount: Confirm and Cancel, with the limit in the reason", async () => {
    const answers: ReviewAnswer[] = [];
    const el = await view("large", (a) => answers.push(a));
    expect(text(el)).toContain("Deposit 25,000.00 USDC into the Earn vault?");
    expect(text(el)).toContain("more than 10,000.00 USDC");
    expect(buttons(el)).toEqual(["Confirm", "Cancel"]);
    await act(async () => (el.querySelectorAll("button")[0] as HTMLButtonElement).click());
    expect(answers).toEqual(["sign"]);
  });

  test("focus moves to it, it is labelled by its headline and described by its reason", async () => {
    const el = await view("mismatch");
    const section = el.querySelector("section")!;
    expect(document.activeElement).toBe(section);
    expect(section.getAttribute("tabindex")).toBe("-1");
    expect(document.getElementById(section.getAttribute("aria-labelledby")!)?.textContent).toBe("This isn't the transaction you asked for");
    expect(document.getElementById(section.getAttribute("aria-describedby")!)?.textContent).toContain("Writz stopped it");
  });

  test("it is announced: an alert for a block or an unknown transaction, a status for a large amount", async () => {
    for (const [mode, role] of [
      ["mismatch", "alert"],
      ["unknown", "alert"],
      ["large", "status"],
    ] as const) {
      const el = await view(mode);
      const live = el.querySelector(`[role="${role}"]`);
      // Mounted empty, then filled, so the change is announced.
      expect(live?.textContent).toBe("");
      await act(async () => new Promise((r) => setTimeout(r, LIVE_DELAY_MS + 20)));
      expect(live?.textContent?.length).toBeGreaterThan(10);
      await act(async () => root?.unmount());
      host?.remove();
      root = null;
    }
  });

  test("Escape cancels, and only once", async () => {
    const answers: ReviewAnswer[] = [];
    const el = await view("large", (a) => answers.push(a));
    const section = el.querySelector("section")!;
    await act(async () => press(section, "Escape"));
    await act(async () => press(section, "Escape"));
    expect(answers).toEqual(["cancel"]);
    expect([...el.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
  });

  test("after an answer, focus returns to the element that had it before", async () => {
    const reviews = new SigningReviews();
    const outside = document.createElement("button");
    outside.textContent = "Deposit 10.00 USDC";
    document.body.appendChild(outside);
    outside.focus();
    const el = await render(
      <ReviewsContext.Provider value={reviews}>
        <SigningCheckSlot>progress</SigningCheckSlot>
      </ReviewsContext.Provider>,
    );
    await act(async () => {
      void reviews.request(REQUESTS.large);
    });
    expect(document.activeElement).toBe(el.querySelector("section"));
    await act(async () => (el.querySelectorAll("section button")[1] as HTMLButtonElement).click());
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  test("the buttons are native buttons in tab order, and Technical details holds the reason", async () => {
    const el = await view("mismatch");
    const b = el.querySelector("button")!;
    expect(b.getAttribute("type")).toBe("button");
    expect(b.tabIndex).toBe(0);
    expect(el.querySelector("details summary")?.textContent).toBe("Technical details");
    expect(el.querySelector("details p")?.textContent).toContain("wrong_contract");
  });
});

describe("SigningCheckSlot and SigningCheckFallback", () => {
  function Page({ reviews, slot }: { reviews: SigningReviews; slot: boolean }) {
    return (
      <ReviewsContext.Provider value={reviews}>
        <div id="shell">
          <SigningCheckFallback />
        </div>
        <div id="panel">{slot ? <SigningCheckSlot>Checking and signing with Pollar.</SigningCheckSlot> : null}</div>
      </ReviewsContext.Provider>
    );
  }

  test("inline in the action's panel when it has a slot, replacing its progress line; answering resolves the request", async () => {
    const reviews = new SigningReviews();
    const el = await render(<Page reviews={reviews} slot />);
    expect(el.querySelector("#panel")!.textContent).toBe("Checking and signing with Pollar.");
    let pending!: Promise<ReviewAnswer>;
    await act(async () => {
      pending = reviews.request(REQUESTS.unknown);
    });
    expect(el.querySelector("#panel section")).not.toBeNull();
    expect(el.querySelector("#shell section")).toBeNull();
    await act(async () => (el.querySelector("#panel button") as HTMLButtonElement).click());
    expect(await pending).toBe("cancel");
    expect(el.querySelector("#panel")!.textContent).toBe("Checking and signing with Pollar.");
  });

  test("in the shell when no panel can show it, so it never waits unseen", async () => {
    const reviews = new SigningReviews();
    const el = await render(<Page reviews={reviews} slot={false} />);
    let pending!: Promise<ReviewAnswer>;
    await act(async () => {
      pending = reviews.request(REQUESTS.large);
    });
    expect(el.querySelector("#shell section")).not.toBeNull();
    await act(async () => (el.querySelector("#shell button") as HTMLButtonElement).click());
    expect(await pending).toBe("sign");
  });

  test("outside a wallet provider the slot shows its children and the fallback nothing", async () => {
    const el = await render(
      <>
        <SigningCheckFallback />
        <SigningCheckSlot>progress</SigningCheckSlot>
      </>,
    );
    expect(el.textContent).toBe("progress");
  });
});
