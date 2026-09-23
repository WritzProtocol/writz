"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { ShieldCheck, EyeOff, MonitorSmartphone, Timer, Landmark } from "lucide-react";
import { spvMetrics } from "../data/bentoMetrics.data";
import { AnimatedCounter } from "./AnimatedCounter";
import { SpvStatusIndicator } from "./SpvStatusIndicator";
import { ProofPulseBadge } from "./ProofPulseBadge";
import { AnimatedChart } from "./AnimatedChart";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const cardBase = "group relative p-6 rounded-2xl border transition-all duration-300 hover:scale-[1.02] overflow-hidden";

export function BentoGrid() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="features" className="py-16 sm:py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-16"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold mb-4"
            style={{ fontFamily: "var(--landing-font-heading)", color: "var(--text-hi)" }}
          >
            What Makes <span style={{ color: "var(--accent)" }}>Writz</span> Different
          </h2>
          <p className="max-w-2xl mx-auto" style={{ color: "var(--text-dim)" }}>
            The first trustless Bitcoin lending protocol on Stellar. Keep every position private.
          </p>
        </motion.div>

        <motion.div
          ref={ref}
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {/* Large card - Bitcoin SPV Verification */}
          <motion.div variants={itemVariants} className={`md:col-span-2 ${cardBase} xoxno-card-accent`}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
              <div>
                <div className="p-2 rounded-lg w-fit mb-4" style={{ background: "var(--card-soft)" }}>
                  <ShieldCheck className="w-5 h-5" style={{ color: "var(--text-dim)" }} strokeWidth={1.5} />
                </div>
                <h3 className="text-xl font-semibold mb-2" style={{ color: "var(--text-hi)" }}>
                  Bitcoin SPV Verification
                </h3>
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  The contract verifies Bitcoin transactions cryptographically. No oracle, no trust.
                </p>
              </div>
              <SpvStatusIndicator />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
              {spvMetrics.map((metric) => (
                <div key={metric.label} className="text-center">
                  <div
                    className="text-3xl sm:text-4xl font-bold mb-1 tracking-tight"
                    style={{ fontFamily: "var(--landing-font-display)", color: "var(--text-hi)" }}
                  >
                    <AnimatedCounter value={metric.num} suffix={metric.suffix} />
                  </div>
                  <div
                    className="text-[10px] sm:text-xs uppercase tracking-wider font-semibold mt-2"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {metric.label}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* ZK-Private Positions */}
          <motion.div variants={itemVariants} className={`${cardBase} xoxno-card-status`}>
            <div className="p-2 rounded-lg w-fit mb-4" style={{ background: "var(--card-soft)" }}>
              <EyeOff className="w-5 h-5" style={{ color: "var(--text-dim)" }} strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-hi)" }}>
              ZK-Private Positions
            </h3>
            <p className="text-sm mb-6" style={{ color: "var(--text-dim)" }}>
              Collateral, debt and health factor stay hidden. Groth16 proofs verified on-chain.
            </p>
            <ProofPulseBadge />
          </motion.div>

          {/* In-Browser Proving */}
          <motion.div variants={itemVariants} className={`${cardBase} xoxno-card-accent`}>
            <div className="p-2 rounded-lg w-fit mb-4" style={{ background: "var(--card-soft)" }}>
              <MonitorSmartphone className="w-5 h-5" style={{ color: "var(--text-dim)" }} strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-hi)" }}>
              In-Browser Proving
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--text-dim)" }}>
              Proofs are generated on your device. Secrets never touch a server.
            </p>
            <AnimatedChart />
          </motion.div>

          {/* Emergency Timelock */}
          <motion.div variants={itemVariants} className={`${cardBase} xoxno-card-status`}>
            <div className="p-2 rounded-lg w-fit mb-4" style={{ background: "var(--card-soft)" }}>
              <Timer className="w-5 h-5" style={{ color: "var(--text-dim)" }} strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-hi)" }}>
              Emergency Timelock
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--text-dim)" }}>
              If Writz disappears, reclaim your BTC alone after the CLTV timelock.
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono" style={{ color: "var(--status)" }}>
                ~30 days
              </span>
              <span style={{ color: "var(--text-dim)" }}>recovery window</span>
            </div>
          </motion.div>

          {/* USDC Lending Pool */}
          <motion.div variants={itemVariants} className={`${cardBase} xoxno-card-accent`}>
            <div className="p-2 rounded-lg w-fit mb-4" style={{ background: "var(--card-soft)" }}>
              <Landmark className="w-5 h-5" style={{ color: "var(--text-dim)" }} strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-hi)" }}>
              USDC Lending Pool
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--text-dim)" }}>
              Suppliers earn yield from borrower interest.
            </p>
            <div className="flex items-center gap-2">
              {["SEP-41", "Soroban", "Groth16"].map((chip) => (
                <span
                  key={chip}
                  className="px-2 py-1 text-xs rounded"
                  style={{ background: "var(--card-soft)", color: "var(--text-dim)" }}
                >
                  {chip}
                </span>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
