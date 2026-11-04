/**
 * Keyboard and screen-reader support for the Stellar Wallets Kit modal.
 *
 * The kit (2.4 to 2.8) renders the wallet list as clickable `<li>` elements,
 * icon-only buttons without a name, and no dialog semantics, Escape handling
 * or focus management, so a keyboard user cannot pick a wallet. This patches
 * the kit's DOM while it is open: it is idempotent and touches nothing else.
 */

const KIT_ROOT = "section.stellar-wallets-kit";
const ITEM_MARK = "data-wz-kit-item";

let installed = false;

const isFocusable = (el: HTMLElement) =>
  el.tabIndex >= 0 && !el.hasAttribute("disabled") && el.getClientRects().length > 0;

function focusables(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>("button, a[href], [tabindex]")].filter(isFocusable);
}

const labelOf = (el: HTMLElement) => (el.getAttribute("aria-label") || el.textContent || "").trim();

function enhance(root: HTMLElement) {
  const dialog = root.querySelector<HTMLElement>(":scope > section") ?? root;
  const title = dialog.querySelector("header h1")?.textContent?.trim() || "Connect wallet";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);

  // The header has a help or back button on the left and close on the right.
  const headerButtons = dialog.querySelectorAll<HTMLButtonElement>("header button");
  headerButtons.forEach((button, i) => {
    if (button.hasAttribute("aria-label")) return;
    const last = i === headerButtons.length - 1 && headerButtons.length > 1;
    const back = button.querySelector("path")?.getAttribute("d")?.startsWith("M7.828");
    button.setAttribute("aria-label", last ? "Close" : back ? "Back" : "What is a wallet?");
  });

  for (const item of dialog.querySelectorAll<HTMLLIElement>("li")) {
    if (item.hasAttribute(ITEM_MARK)) continue;
    item.setAttribute(ITEM_MARK, "");
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    const name = item.querySelector("img")?.getAttribute("alt")?.replace(/ icon$/, "") ?? item.textContent?.trim();
    if (name) item.setAttribute("aria-label", name);
    item.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      item.click();
    });
  }
}

function closeButton(root: HTMLElement): HTMLButtonElement | null {
  const buttons = root.querySelectorAll<HTMLButtonElement>("header button");
  return buttons.length ? buttons[buttons.length - 1] : null;
}

/** Installs the patch once, for every time the kit opens its modal. */
export function installKitA11y() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  let open: HTMLElement | null = null;
  let focusPending = false;
  // The trigger is disabled, and can be re-rendered, while the kit is open, so
  // remember the last focus outside it and its label to find it again.
  let lastOutside: HTMLElement | null = null;
  let lastLabel = "";
  document.addEventListener("focusin", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(KIT_ROOT)) return;
    lastOutside = target;
    lastLabel = labelOf(target);
  });

  const onKeydown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeButton(open)?.click();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables(open);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active || !open.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const sync = () => {
    const root = document.querySelector<HTMLElement>(KIT_ROOT);
    if (root) {
      enhance(root);
      if (open !== root) {
        open = root;
        focusPending = true;
        document.addEventListener("keydown", onKeydown, true);
      }
      // The wallet list renders after the modal, once supported wallets are known.
      if (focusPending) {
        const item = root.querySelector<HTMLElement>(`[${ITEM_MARK}]`);
        if (item) {
          focusPending = false;
          item.focus();
        } else if (!root.contains(document.activeElement)) {
          focusables(root)[0]?.focus();
        }
      }
    } else if (open) {
      open = null;
      focusPending = false;
      document.removeEventListener("keydown", onKeydown, true);
      const [target, label] = [lastOutside, lastLabel];
      // Wait for the trigger to be enabled again before returning focus to it.
      setTimeout(() => {
        if (document.querySelector(KIT_ROOT)) return;
        const again = target?.isConnected
          ? target
          : [...document.querySelectorAll<HTMLElement>("button, a[href]")].find((el) => label && labelOf(el) === label);
        again?.focus();
      }, 50);
    }
  };

  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
}
