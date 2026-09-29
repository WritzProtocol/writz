import type { NavItem } from "../types/navigation.types";
import { DOCS_URL } from "../constants";

export const navItems: NavItem[] = [
  { label: "How it works", href: "#how" },
  { label: "Earn", href: "#earn" },
  { label: "Borrow", href: "#borrow" },
  { label: "Docs", href: DOCS_URL, keepOnMobile: true },
];
