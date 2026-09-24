"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/** Owns the shared state for a SplitFlapText run: its characters, whether
 * the one-time entrance delay has elapsed, and the replay trigger fired on
 * hover. */
export function useSplitFlapText(text: string) {
  const chars = useMemo(() => text.split(""), [text]);
  const [animationKey, setAnimationKey] = useState(0);
  const [hasInitialized, setHasInitialized] = useState(false);

  const replay = useCallback(() => setAnimationKey((prev) => prev + 1), []);

  useEffect(() => {
    const timer = setTimeout(() => setHasInitialized(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  return { chars, animationKey, hasInitialized, replay };
}
