import { SCENARIOS } from "./scenarios";
import type { MockWorld } from "./types";

/** The skeleton layout a scenario settles into: Stellar wallet, loans found, deposit step. */
export function skeletonHint(w: MockWorld): string {
  const stellar = w.wallets.stellar;
  const wallet = stellar ? "1" : "0";
  const found = stellar?.loans === "found" && w.positions.some((p) => p.local.position && !p.local.pendingDeposit);
  const loans = found || w.reclaim ? "1" : "0";
  const d = w.deposit;
  const step = w.positions.some((p) => p.local.pendingDeposit)
    ? "other"
    : d?.amountSats && !d.amountError && stellar && w.wallets.bitcoin
      ? "review"
      : d?.amountSats && !d.amountError && (stellar || w.wallets.connect)
        ? "other"
        : "amount";
  return wallet + loans + step;
}

export function skeletonHints(): Record<string, string> {
  const now = Date.now();
  return Object.fromEntries(SCENARIOS.map((s) => [s.id, skeletonHint(s.build(now))]));
}

/**
 * Runs before first paint so each skeleton can take the layout the page will settle into.
 * Without a scenario it guesses from what this browser remembers: a wallet and its loans, or a deposit in progress.
 */
export function skeletonScript(hints: Record<string, string> | null): string {
  return `(function(){try{var d=document.documentElement,m=${JSON.stringify(hints)},q=new URLSearchParams(location.search).get("scenario"),h=m&&q?m[q]:null;if(!h){var s=localStorage,w=s.getItem("writz.walletBackend")?"1":"0",l="0",st="amount";for(var i=0;i<s.length;i++){var k=s.key(i)||"",v=s.getItem(k);if(w==="1"&&k.indexOf("writz.positions.")===0&&v&&v!=="[]")l="1";if(k.indexOf("writz.pendingDeposit.")===0&&v&&v!=="null")st="other";}h=w+l+st;}d.setAttribute("data-wz-wallet",h.charAt(0));d.setAttribute("data-wz-loans",h.charAt(1));d.setAttribute("data-wz-step",h.slice(2));}catch(e){}})();`;
}
