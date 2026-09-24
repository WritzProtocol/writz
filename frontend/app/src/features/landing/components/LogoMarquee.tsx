"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { ecosystemLogos } from "../data/ecosystem.data";

export function LogoMarquee() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section ref={ref} className="py-16 overflow-hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : {}}
        transition={{ duration: 0.6 }}
        className="text-center mb-10"
      >
        <p className="text-sm uppercase tracking-wider font-medium" style={{ color: "var(--text-dim)" }}>
          Powered by the ecosystem
        </p>
      </motion.div>

      <div className="relative">
        {/* Fade masks */}
        <div
          className="absolute left-0 top-0 bottom-0 w-32 z-10 pointer-events-none"
          style={{ background: "linear-gradient(to right, var(--bg), transparent)" }}
        />
        <div
          className="absolute right-0 top-0 bottom-0 w-32 z-10 pointer-events-none"
          style={{ background: "linear-gradient(to left, var(--bg), transparent)" }}
        />

        <div className="marquee-track">
          <div className="flex animate-marquee">
            {[...ecosystemLogos, ...ecosystemLogos].map((logo, index) => {
              const Icon = logo.icon;
              return (
                <div
                  key={index}
                  className="flex items-center justify-center min-w-[160px] h-16 mx-8 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all duration-300"
                >
                  <div className="flex items-center gap-3" style={{ color: "var(--text-body)" }}>
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm border"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}
                    >
                      <Icon size={20} strokeWidth={1.5} style={{ color: "var(--text-hi)" }} />
                    </div>
                    <span
                      className="font-medium text-lg tracking-tight"
                      style={{ fontFamily: "var(--landing-font-heading)", color: "var(--text-body)" }}
                    >
                      {logo.name}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
