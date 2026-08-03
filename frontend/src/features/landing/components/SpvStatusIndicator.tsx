"use client";

import { motion } from "framer-motion";
import { useSpvStatus } from "../hooks/useSpvStatus";

export function SpvStatusIndicator() {
  const dots = useSpvStatus();

  return (
    <div className="flex items-center gap-2">
      {dots.map((active, i) => (
        <motion.div
          key={i}
          className="w-2 h-2 rounded-full"
          style={{ background: active ? "var(--status)" : "var(--border-hover)" }}
          animate={active ? { scale: [1, 1.2, 1] } : {}}
          transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}
