"use client";

import { motion, useReducedMotion } from "framer-motion";

const DOT_COUNT = 6;

/** Decorative only. Not wired to anything, so never give it counts or labels. */
export function SpvDots() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {Array.from({ length: DOT_COUNT }, (_, i) => (
        <motion.div
          key={i}
          className="w-2 h-2 rounded-full"
          style={{ background: "var(--status)" }}
          animate={reduceMotion ? undefined : { scale: [1, 1.2, 1] }}
          transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}
