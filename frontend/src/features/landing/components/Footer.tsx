"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { footerLinkGroups, footerBottomLinks } from "../data/footerLinks.data";

export function Footer() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <footer ref={ref} className="border-t" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
      <div className="max-w-6xl mx-auto px-4 py-12 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8"
        >
          <div className="sm:col-span-2 md:col-span-1">
            <a href="#" className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
                <span className="font-bold text-sm" style={{ color: "var(--accent-contrast)" }}>
                  W
                </span>
              </div>
              <span className="font-semibold" style={{ color: "var(--text-hi)" }}>
                Writz
              </span>
            </a>
            <p className="text-sm mb-4" style={{ color: "var(--text-dim)" }}>
              Trustless, ZK-private Bitcoin lending on Stellar.
            </p>
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <span className="w-2 h-2 rounded-full pulse-glow" style={{ background: "var(--status)", color: "var(--status)" }} />
              <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                All contracts live on testnet
              </span>
            </div>
          </div>

          {footerLinkGroups.map(({ title, links }) => (
            <div key={title}>
              <h4 className="text-sm font-semibold mb-4" style={{ color: "var(--text-hi)" }}>
                {title}
              </h4>
              <ul className="space-y-3">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <a href={href} className="text-sm transition-colors hover:opacity-100" style={{ color: "var(--text-dim)" }}>
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-16 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            &copy; {new Date().getFullYear()} Writz Protocol. Apache-2.0 License.
          </p>
          <div className="flex items-center gap-6">
            {footerBottomLinks.map(({ label, href }) => (
              <a key={label} href={href} className="text-sm transition-colors" style={{ color: "var(--text-dim)" }}>
                {label}
              </a>
            ))}
          </div>
        </motion.div>
      </div>
    </footer>
  );
}
