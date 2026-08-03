"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSplitFlapAudioEngine } from "../hooks/useSplitFlapAudioEngine";
import type { SplitFlapAudioContextValue } from "../types/splitFlap.types";

const SplitFlapAudioContext = createContext<SplitFlapAudioContextValue | null>(null);

export function useSplitFlapAudio() {
  return useContext(SplitFlapAudioContext);
}

export function SplitFlapAudioProvider({ children }: { children: ReactNode }) {
  const engine = useSplitFlapAudioEngine();
  return <SplitFlapAudioContext.Provider value={engine}>{children}</SplitFlapAudioContext.Provider>;
}
