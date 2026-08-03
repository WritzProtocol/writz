"use client";

import { motion } from "framer-motion";
import type { ProtocolRole } from "../types/products.types";

const ROLES: ProtocolRole[] = ["borrower", "lender"];

interface RoleToggleProps {
  role: ProtocolRole;
  onChange: (role: ProtocolRole) => void;
}

export function RoleToggle({ role, onChange }: RoleToggleProps) {
  return (
    <div
      className="inline-flex items-center p-1 rounded-full border"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {ROLES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className="relative px-4 py-2 text-sm font-medium rounded-full transition-colors capitalize"
          style={{ color: role === r ? "var(--text-hi)" : "var(--text-dim)" }}
        >
          {role === r && (
            <motion.div
              layoutId="role-toggle"
              className="absolute inset-0 rounded-full"
              style={{ background: "var(--card-soft)", border: "1px solid var(--border-hover)" }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
          <span className="relative z-10">{r}</span>
        </button>
      ))}
    </div>
  );
}
