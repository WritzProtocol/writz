"use client";

import { useEffect, useRef } from "react";
import { animate, useInView } from "framer-motion";

/** Counts up from 0 to `value` once the returned ref scrolls into view. */
export function useAnimatedCounter(value: number, suffix = "") {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  useEffect(() => {
    if (!isInView || !ref.current) return;
    const node = ref.current;
    const controls = animate(0, value, {
      duration: 2,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        node.textContent = Math.floor(latest).toString() + suffix;
      },
    });
    return () => controls.stop();
  }, [value, suffix, isInView]);

  return ref;
}
