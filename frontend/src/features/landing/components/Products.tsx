"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { productPlans } from "../data/productPlans.data";
import { useRoleToggle } from "../hooks/useRoleToggle";
import { RoleToggle } from "./RoleToggle";
import { PlanCard } from "./PlanCard";

export function Products() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const { role, setRole } = useRoleToggle();

  return (
    <section id="products" className="py-16 sm:py-24 px-4">
      <div className="max-w-6xl mx-auto">
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
          <p className="max-w-2xl mx-auto mb-8" style={{ color: "var(--text-dim)" }}>
            Start borrowing privately today. More products as the protocol scales.
          </p>

          <RoleToggle role={role} onChange={setRole} />
        </motion.div>

        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {productPlans.map((plan, index) => (
            <PlanCard key={plan.name} plan={plan} index={index} isInView={isInView} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
