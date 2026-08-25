"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { plansForRole, roleTaglines } from "../data/productPlans.data";
import { useRoleToggle } from "../hooks/useRoleToggle";
import { RoleToggle } from "./RoleToggle";
import { PlanCard } from "./PlanCard";

export function Products() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const { role, setRole } = useRoleToggle();

  // The toggle swaps which plans are on show, so the cards remount on every
  // change - keying them off `role` replays the stagger instead of leaving
  // the swap looking like a no-op.
  const plans = plansForRole(role);

  return (
    <section id="products" className="py-16 sm:py-24 px-4">
      <div ref={ref} className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold mb-4"
            style={{ fontFamily: "var(--landing-font-heading)", color: "var(--text-hi)" }}
          >
            Protocol <span style={{ color: "var(--accent)" }}>Products</span>
          </h2>
          <motion.p
            key={role}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="max-w-2xl mx-auto mb-8 min-h-[3.5rem]"
            style={{ color: "var(--text-dim)" }}
          >
            {roleTaglines[role]}
          </motion.p>

          <RoleToggle role={role} onChange={setRole} />
        </motion.div>

        <motion.div
          key={role}
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className={`grid grid-cols-1 gap-6 mx-auto ${
            plans.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2 max-w-4xl"
          }`}
        >
          {plans.map((plan, index) => (
            <PlanCard key={plan.name} plan={plan} index={index} isInView={isInView} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
