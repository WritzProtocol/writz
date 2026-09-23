"use client";

import { motion } from "framer-motion";
import { useProofPulse } from "../hooks/useProofPulse";

export function ProofPulseBadge() {
  const pressed = useProofPulse();

  return (
    <div className="flex items-center gap-1">
      <motion.kbd
        animate={pressed ? { scale: 0.95, y: 2 } : { scale: 1, y: 0 }}
        className="px-2 py-1 text-xs rounded font-mono border"
        style={{ background: "var(--card-soft)", borderColor: "var(--border-hover)", color: "var(--text-body)" }}
      >
        π
      </motion.kbd>
      <motion.kbd
        animate={pressed ? { scale: 0.95, y: 2 } : { scale: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="px-2 py-1 text-xs rounded font-mono border"
        style={{ background: "var(--card-soft)", borderColor: "var(--border-hover)", color: "var(--status)" }}
      >
        ✓
      </motion.kbd>
    </div>
  );
}
