"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useIntersectionPlayState } from "../hooks/useIntersectionPlayState";
import { APP_ROUTE, DOCS_URL } from "../constants";
import { LiquidGoldText } from "./LiquidGoldText";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export function Hero() {
  const glowRef = useIntersectionPlayState<HTMLDivElement>();

  return (
    <section className="relative flex flex-col justify-center px-4 pt-28 pb-16 overflow-hidden lg:min-h-screen lg:pt-24">
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, var(--bg), var(--bg), var(--card))" }}
      />

      {/* Soft ambient glow */}
      <motion.div
        ref={glowRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2, ease: "easeOut" }}
        className="hero-glow pointer-events-none"
      />

      <div className="relative z-10 max-w-6xl mx-auto w-full">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            custom={0}
            variants={fadeUp}
            className="flex items-center justify-center gap-2 mb-6 lg:mb-8"
          >
            <span
              className="w-1.5 h-1.5 rounded-full pulse-glow"
              style={{ background: "var(--status)", color: "var(--status)" }}
            />
            <span className="text-xs font-medium uppercase tracking-[0.15em]" style={{ color: "var(--text-dim)" }}>
              Live on Stellar Testnet
            </span>
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            custom={0.08}
            variants={fadeUp}
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-[4.5rem] font-semibold tracking-tight leading-[1.08] lg:leading-[1.05] mb-6 lg:mb-7"
            style={{ fontFamily: "var(--landing-font-display)", color: "var(--text-hi)" }}
          >
            <LiquidGoldText tone="silver">Bitcoin</LiquidGoldText> was built to be yours.
            <br />
            <span style={{ color: "var(--text-dim)" }}>
              Your <LiquidGoldText>loans</LiquidGoldText> should be too.
            </span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            custom={0.16}
            variants={fadeUp}
            className="text-base sm:text-lg max-w-xl mx-auto leading-relaxed mb-8 lg:mb-10"
            style={{ color: "var(--text-body)" }}
          >
            No bridge. No custodian. No wrapped tokens. No public balance sheet. Trustless Bitcoin lending on
            Stellar.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            custom={0.24}
            variants={fadeUp}
            className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4"
          >
            <Link
              href={APP_ROUTE}
              className="shimmer-btn w-full sm:w-auto rounded-full px-7 h-12 text-base font-normal inline-flex items-center justify-center shadow-lg border"
              style={{
                background: "#141110",
                borderColor: "#3d3221",
                color: "#D4AF37",
                boxShadow: "0 10px 30px -10px rgba(212, 175, 55, 0.35)",
              }}
            >
              <LiquidGoldText>Launch App</LiquidGoldText>
              <ArrowRight className="ml-2 w-4 h-4" />
            </Link>
            <a
              href={DOCS_URL}
              className="w-full sm:w-auto rounded-full px-7 h-12 text-base font-normal border transition-colors inline-flex items-center justify-center"
              style={{ borderColor: "var(--border)", color: "var(--text-body)" }}
            >
              Read the Docs
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
