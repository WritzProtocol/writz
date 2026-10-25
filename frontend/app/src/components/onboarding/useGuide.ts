"use client";

import { useMockWorld } from "@/components/ui/hooks";
import { useOnboarding, type Onboarding } from "@/lib/onboarding/OnboardingProvider";

const noop = () => {};

/** The onboarding state, or the harness scenario's while the mock harness is on. */
export function useGuide(): Onboarding {
  const world = useMockWorld();
  const live = useOnboarding();
  const o = world?.onboarding;
  if (!o) return world ? { ...live, guided: false } : live;
  return { guided: true, claim: o.claim, milestones: o.milestones ?? {}, retryClaim: noop, report: noop };
}
