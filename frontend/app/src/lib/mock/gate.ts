import { config } from "@/config";
import type { DeployTarget } from "@/config/target";
import { getScenario } from "./scenarios";
import type { Scenario } from "./types";

/**
 * Dev-only mock harness gate: on only when NEXT_PUBLIC_UI_MOCK=1, never on a
 * mainnet target, and only for a known `?scenario=<id>`.
 */
export function mockEnabled(flag: string | undefined, target: DeployTarget): boolean {
  return flag === "1" && target !== "mainnet";
}

export function scenarioFromSearch(search: string, enabled: boolean): Scenario | null {
  if (!enabled) return null;
  const id = new URLSearchParams(search).get("scenario");
  return id ? getScenario(id) : null;
}

export const UI_MOCK = mockEnabled(process.env.NEXT_PUBLIC_UI_MOCK, config.target);

/** The scenario selected in the current URL, or null whenever the harness is off. */
export function activeScenario(): Scenario | null {
  if (!UI_MOCK || typeof window === "undefined") return null;
  return scenarioFromSearch(window.location.search, UI_MOCK);
}
