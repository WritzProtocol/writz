"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { navItems } from "../data/navigation.data";
import { useNavbarMenu } from "../hooks/useNavbarMenu";
import { APP_ROUTE } from "../constants";
import { LiquidGoldText } from "./LiquidGoldText";

export function Navbar() {
  const { hoveredIndex, isMobileMenuOpen, handleMouseEnter, handleMouseLeave, toggleMobileMenu, closeMobileMenu } =
    useNavbarMenu();

  return (
    <motion.header
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-3xl"
    >
      <nav
        className="relative flex items-center justify-between px-4 py-3 rounded-full border"
        style={{ background: "color-mix(in srgb, var(--card) 94%, transparent)", borderColor: "var(--border)" }}
      >
        {/* Logo */}
        <a href="#" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
            <span className="font-bold text-sm" style={{ color: "var(--accent-contrast)" }}>
              W
            </span>
          </div>
          <span className="font-semibold text-sm hidden sm:block" style={{ color: "var(--text-hi)" }}>
            Writz
          </span>
        </a>

        {/* Desktop Nav Items */}
        <div className="hidden md:flex items-center gap-1 relative">
          {navItems.map((item, index) => (
            <a
              key={item.label}
              href={item.href}
              className="relative px-4 py-2 text-xs transition-colors"
              style={{ color: hoveredIndex === index ? "var(--text-hi)" : "var(--text-dim)" }}
              onMouseEnter={() => handleMouseEnter(index)}
              onMouseLeave={handleMouseLeave}
            >
              {hoveredIndex === index && (
                <motion.div
                  layoutId="navbar-hover"
                  className="absolute inset-0 rounded-full"
                  style={{ background: "var(--card)" }}
                  initial={false}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
              <span className="relative z-10">{item.label}</span>
            </a>
          ))}
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href={APP_ROUTE}
            className="shimmer-btn rounded-full px-4 py-2 text-xs font-medium border inline-block"
            style={{ background: "#141110", borderColor: "#3d3221" }}
          >
            <LiquidGoldText>Launch App</LiquidGoldText>
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2"
          style={{ color: "var(--text-dim)" }}
          onClick={toggleMobileMenu}
          aria-label="Toggle menu"
          aria-expanded={isMobileMenuOpen}
        >
          {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-full left-0 right-0 mt-2 p-4 rounded-2xl border"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-col gap-2">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="px-4 py-3 text-xs rounded-lg transition-colors"
                style={{ color: "var(--text-dim)" }}
                onClick={closeMobileMenu}
              >
                {item.label}
              </a>
            ))}
            <hr style={{ borderColor: "var(--border)" }} className="my-2" />
            <Link
              href={APP_ROUTE}
              onClick={closeMobileMenu}
              className="shimmer-btn rounded-full py-2 text-xs font-medium border text-center"
              style={{ background: "#141110", borderColor: "#3d3221" }}
            >
              <LiquidGoldText>Launch App</LiquidGoldText>
            </Link>
          </div>
        </motion.div>
      )}
    </motion.header>
  );
}
