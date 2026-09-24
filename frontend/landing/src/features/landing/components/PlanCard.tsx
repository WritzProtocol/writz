"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Check } from "lucide-react";
import type { ProductPlan } from "../types/products.types";
import { BorderBeam } from "./BorderBeam";

interface PlanCardProps {
  plan: ProductPlan;
  index: number;
  isInView: boolean;
}

export function PlanCard({ plan, index, isInView }: PlanCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: 0.3 + index * 0.1 }}
      className={`relative p-6 rounded-2xl border transition-all duration-300 hover:scale-[1.02] ${plan.highlighted ? "xoxno-card-accent" : ""}`}
      style={!plan.highlighted ? { background: "var(--card-soft)", borderColor: "var(--border)" } : {}}
    >
      {plan.highlighted && <BorderBeam />}

      {plan.badge && (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-xs font-medium rounded-full"
          style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
        >
          {plan.badge}
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-xl font-semibold mb-2" style={{ color: "var(--text-hi)" }}>
          {plan.name}
        </h3>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          {plan.description}
        </p>
      </div>

      <div className="mb-6">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold font-mono" style={{ color: "var(--text-hi)" }}>
            {plan.stat}
          </span>
        </div>
        <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
          {plan.statLabel}
        </p>
      </div>

      <ul className="space-y-3 mb-8">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-center gap-3 text-sm" style={{ color: "var(--text-body)" }}>
            <Check className="w-4 h-4 shrink-0" style={{ color: "var(--status)" }} strokeWidth={1.5} />
            {feature}
          </li>
        ))}
      </ul>

      {plan.ctaHref ? (
        <Link
          href={plan.ctaHref}
          className={`block text-center w-full rounded-full py-2.5 text-sm font-medium ${plan.highlighted ? "shimmer-btn" : ""}`}
          style={
            plan.highlighted
              ? { background: "var(--accent)", color: "var(--accent-contrast)" }
              : { background: "var(--card)", color: "var(--text-hi)", border: "1px solid var(--border-hover)" }
          }
        >
          {plan.cta}
        </Link>
      ) : (
        <button
          className={`w-full rounded-full py-2.5 text-sm font-medium ${plan.highlighted ? "shimmer-btn" : ""}`}
          style={
            plan.highlighted
              ? { background: "var(--accent)", color: "var(--accent-contrast)" }
              : { background: "var(--card)", color: "var(--text-hi)", border: "1px solid var(--border-hover)" }
          }
        >
          {plan.cta}
        </button>
      )}
    </motion.div>
  );
}
