"use client";

import { useEffect, useState } from "react";

/** Toggles a brief "pressed" state every 3s to animate the π / ✓ keycaps. */
export function useProofPulse() {
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setPressed(true);
      const timeout = setTimeout(() => setPressed(false), 200);
      return () => clearTimeout(timeout);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return pressed;
}
