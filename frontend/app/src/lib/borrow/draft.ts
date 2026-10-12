const KEY = "writz.draftAmount";

/** Hands home's preview amount to the deposit journey without putting it in the URL. */
export function setDraftAmount(amount: string): void {
  try {
    window.sessionStorage.setItem(KEY, amount);
  } catch {
    // Storage blocked: the journey just starts empty.
  }
}

export function readDraftAmount(): string | undefined {
  try {
    return window.sessionStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function clearDraftAmount(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
