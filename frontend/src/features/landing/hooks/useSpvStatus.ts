"use client";

import { useEffect, useState } from "react";

const DOT_COUNT = 6;

/** Simulates SPV confirmation dots flickering in/out every 2s. */
export function useSpvStatus() {
  const [dots, setDots] = useState<boolean[]>(() => Array(DOT_COUNT).fill(true));

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => prev.map((_, i) => (i < DOT_COUNT ? true : Math.random() > 0.2)));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return dots;
}
