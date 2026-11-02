import { LENDING_ENABLED } from "@/config";

export type NavId = "home" | "borrow" | "earn" | "lend" | "protocol";

type NavItem = { id: NavId; label: string; href: string };

const PROTOCOL: NavItem[] = [
  { id: "home", label: "Home", href: "/" },
  { id: "borrow", label: "Borrow", href: "/borrow/new" },
  { id: "lend", label: "Lend", href: "/lend" },
];

/** The main nav for this deploy. Home is the loans dashboard, so an Earn-only
 * deploy (mainnet, #122) shows Earn alone - its `/` redirects to `/earn`. */
export function navFor(lending: boolean): NavItem[] {
  return lending ? PROTOCOL : [{ id: "earn", label: "Earn", href: "/earn" }];
}

/** Products built on other protocols, kept apart from the Writz protocol in their own group. */
export function integrationsFor(lending: boolean): NavItem[] {
  return lending ? [{ id: "earn", label: VAULT_NAME, href: "/earn" }] : [];
}

export const VAULT_NAME = "DeFindex vault";
export const NAV_MAIN = navFor(LENDING_ENABLED);
export const NAV_INTEGRATIONS = integrationsFor(LENDING_ENABLED);

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** The nav item a route marks with aria-current. A loan belongs to Home; Borrow means starting a new one. */
export function currentNav(pathname: string): NavId | null {
  if (pathname === "/" || under(pathname, "/loans")) return "home";
  if (under(pathname, "/borrow")) return "borrow";
  if (under(pathname, "/earn")) return "earn";
  if (under(pathname, "/lend")) return "lend";
  if (under(pathname, "/protocol")) return "protocol";
  return null;
}
