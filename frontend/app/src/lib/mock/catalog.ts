import { SCENARIOS } from "./scenarios";
import type { MockArea, Scenario } from "./types";

const GROUPS: readonly { area: MockArea; label: string }[] = [
  { area: "global", label: "Global" },
  { area: "home", label: "Home" },
  { area: "onboarding", label: "Guided first loan" },
  { area: "deposit", label: "Borrow" },
  { area: "loan", label: "Loan" },
  { area: "earn", label: "Earn" },
  { area: "lend", label: "Lend" },
  { area: "protocol", label: "Protocol" },
  { area: "help", label: "Reclaim" },
  { area: "tx", label: "Transactions" },
  { area: "status", label: "Loan status" },
];

export interface CatalogEntry {
  id: string;
  title: string;
  route: string;
  href: string;
}

export interface CatalogGroup {
  area: MockArea;
  label: string;
  entries: CatalogEntry[];
}

/** Every harness scenario by area with the route it opens on, or null while the harness is off. */
export function scenarioCatalog(enabled: boolean, scenarios: readonly Scenario[] = SCENARIOS, now = Date.now()): CatalogGroup[] | null {
  if (!enabled) return null;
  return GROUPS.map(({ area, label }) => ({
    area,
    label,
    entries: scenarios
      .filter((s) => s.area === area)
      .map((s) => {
        const route = s.build(now).route;
        return { id: s.id, title: s.title, route, href: `${route}?scenario=${encodeURIComponent(s.id)}` };
      }),
  })).filter((g) => g.entries.length > 0);
}
