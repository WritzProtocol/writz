"use client";

import { motion, useInView } from "framer-motion";
import Link from "next/link";
import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { SplitFlapText } from "./SplitFlapText";
import { SplitFlapAudioProvider } from "./SplitFlapAudioProvider";
import { APP_ROUTE, GITHUB_URL } from "../constants";
import { LiquidGoldText } from "./LiquidGoldText";

export function FinalCTA() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-16 sm:py-24 px-4">
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 40 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-4xl mx-auto text-center"
      >
        <h2
          className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 tracking-tight"
          style={{ fontFamily: "var(--landing-font-display)", color: "var(--text-hi)" }}
        >
          Your <span style={{ color: "#D4AF37" }}>keys</span>. Your <span style={{ color: "#D4AF37" }}>coins</span>.
          Your <span style={{ color: "#D4AF37" }}>loans</span>.
        </h2>
        <p className="text-lg sm:text-xl mb-10 max-w-2xl mx-auto" style={{ color: "var(--text-dim)" }}>
          The first trustless Bitcoin lending protocol on Stellar. Keep every position private.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <Link
            href={APP_ROUTE}
            className="shimmer-btn w-full sm:w-auto rounded-full px-8 h-14 text-base font-medium inline-flex items-center justify-center shadow-lg border"
            style={{
              background: "#141110",
              borderColor: "#3d3221",
              color: "#D4AF37",
              boxShadow: "0 10px 30px -10px rgba(212, 175, 55, 0.35)",
            }}
          >
            <LiquidGoldText>Launch App</LiquidGoldText>
            <ArrowRight className="ml-2 w-5 h-5" />
          </Link>
          <a
            href={GITHUB_URL}
            className="w-full sm:w-auto rounded-full px-8 h-14 text-base font-medium border transition-colors inline-flex items-center justify-center"
            style={{ borderColor: "var(--border)", color: "var(--text-body)" }}
          >
            View on GitHub
          </a>
        </div>

        <p className="mt-8 text-sm mb-10 sm:mb-16" style={{ color: "var(--text-dim)" }}>
          Open source · Apache-2.0 · Audits before mainnet.
        </p>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="flex flex-col items-center justify-center relative z-20 mt-12 w-full"
        >
          <SplitFlapAudioProvider>
            <div className="flex flex-col items-center max-w-full">
              <SplitFlapText text="WRITZ PROTOCOL" speed={80} />
            </div>
          </SplitFlapAudioProvider>
        </motion.div>
      </motion.div>
    </section>
  );
}
