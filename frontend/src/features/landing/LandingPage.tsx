"use client";

import dynamic from "next/dynamic";
import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";
import { LogoMarquee } from "./components/LogoMarquee";
import { SmoothScroll } from "./components/SmoothScroll";
import { workSans } from "./fonts";
import "@/shared/design-system/landing-tokens.css";
import "@/shared/design-system/landing-animations.css";

// Below-the-fold sections are code-split: the user never needs their JS
// before they've scrolled past the hero/marquee, and each one carries its
// own motion/SVG/interval-driven widgets.
const BentoGrid = dynamic(() => import("./components/BentoGrid").then((m) => m.BentoGrid));
const Products = dynamic(() => import("./components/Products").then((m) => m.Products));
const FinalCTA = dynamic(() => import("./components/FinalCTA").then((m) => m.FinalCTA));
const Footer = dynamic(() => import("./components/Footer").then((m) => m.Footer));

/**
 * Orchestrator only: composes the marketing sections. No business logic
 * lives here. The palette is fixed (Gold & Black - see landing-tokens.css)
 * so there's no runtime theme switcher.
 */
export function LandingPage() {
  return (
    <div className={`landing-root ${workSans.variable}`}>
      <div className="noise-overlay" aria-hidden="true" />
      <SmoothScroll>
        <main className="min-h-screen" style={{ background: "var(--bg)" }}>
          <Navbar />
          <Hero />
          <LogoMarquee />
          <BentoGrid />
          <Products />
          <FinalCTA />
          <Footer />
        </main>
      </SmoothScroll>
    </div>
  );
}
