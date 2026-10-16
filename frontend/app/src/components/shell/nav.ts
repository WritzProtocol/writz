export type NavId = "home" | "borrow" | "earn" | "lend" | "protocol";

export const NAV_MAIN: { id: NavId; label: string; href: string }[] = [
  { id: "home", label: "Home", href: "/" },
  { id: "borrow", label: "Borrow", href: "/borrow/new" },
  { id: "earn", label: "Earn", href: "/earn" },
  { id: "lend", label: "Lend", href: "/lend" },
];

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
