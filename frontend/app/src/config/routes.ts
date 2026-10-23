/**
 * Which requests an Earn-only deploy (mainnet, #122) must not serve.
 *
 * Pure so it is testable; `src/proxy.ts` applies it before any route renders.
 * Hiding links is not enough on a deploy holding real funds: a lending page
 * reached by URL would still try to build loans against contracts that do not
 * exist there, so the paths themselves are closed.
 */
export const LENDING_PATHS = ["/borrow", "/loans", "/lend", "/help/reclaim", "/dev"] as const;

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export type RouteDecision = { kind: "next" } | { kind: "redirect"; to: string } | { kind: "not-found" };

export function routeFor(pathname: string, lending: boolean): RouteDecision {
  if (lending) return { kind: "next" };
  // Home is the loans dashboard; on an Earn-only deploy Earn is home.
  if (pathname === "/") return { kind: "redirect", to: "/earn" };
  if (LENDING_PATHS.some((base) => under(pathname, base))) return { kind: "not-found" };
  return { kind: "next" };
}
