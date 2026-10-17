import { LENDING_ENABLED } from "@/config";

export type NavId = "home" | "borrow" | "earn" | "lend" | "protocol";

const NAV_ALL: { id: NavId; label: string; href: string; lending: boolean }[] = [
  { id: "home", label: "Home", href: "/", lending: true },
  { id: "borrow", label: "Borrow", href: "/borrow/new", lending: true },
  { id: "earn", label: "Earn", href: "/earn", lending: false },
  { id: "lend", label: "Lend", href: "/lend", lending: true },
];

/** The main nav for this deploy. Home is the loans dashboard, so an Earn-only
 * deploy (mainnet, #122) shows Earn alone - its `/` redirects to `/earn`. */
export function navFor(lending: boolean): { id: NavId; label: string; href: string }[] {
  return NAV_ALL.filter((item) => lending || !item.lending).map(({ id, label, href }) => ({ id, label, href }));
}

export const NAV_MAIN = navFor(LENDING_ENABLED);

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
