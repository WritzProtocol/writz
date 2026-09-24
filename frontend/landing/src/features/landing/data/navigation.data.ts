import type { NavItem } from "../types/navigation.types";
import { APP_ROUTE, DOCS_URL } from "../constants";

export const navItems: NavItem[] = [
  { label: "Products", href: "#products" },
  { label: "How it works", href: "#features" },
  { label: "Metrics", href: `${APP_ROUTE}/metrics` },
  { label: "Docs", href: DOCS_URL },
  { label: "Security", href: "#" },
];
