"use client";

import { useEffect, useRef } from "react";
import { liquidGoldPalettes } from "../data/liquidGoldPalettes.data";
import type { LiquidGoldTone } from "../types/liquidGoldText.types";

/**
 * Drives the drifting radial-gradient "liquid metal" background behind a
 * background-clip:text span. Pauses when off-screen, tab is hidden, or the
 * user prefers reduced motion; otherwise updates every 3rd frame (the drift
 * is slow enough that this stays visually smooth while cutting paint work).
 */
export function useLiquidGoldAnimation(tone: LiquidGoldTone) {
  const ref = useRef<HTMLSpanElement>(null);
  const palette = liquidGoldPalettes[tone];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let shouldReduceMotion = mediaQuery.matches;
    let frame: number;
    let t = Math.random() * 10;
    let paused = false;
    let offscreen = false;
    let tick = 0;

    const staticFallback = `linear-gradient(135deg, ${palette.highlight} 0%, ${palette.base} 45%, ${palette.bronze} 100%)`;

    const animate = () => {
      if (paused || shouldReduceMotion) return;
      frame = requestAnimationFrame(animate);
      if (offscreen) return;

      tick++;
      if (tick % 3 !== 0) return;

      t += 0.066;

      const b1x = 50 + 28 * Math.sin(t * 0.7);
      const b1y = 50 + 22 * Math.cos(t * 0.5);
      const b2x = 50 + 22 * Math.sin(t * 0.4 + 2.0);
      const b2y = 50 + 28 * Math.cos(t * 0.6 + 1.2);
      const b3x = 50 + 32 * Math.sin(t * 0.85 + 4.2);
      const b3y = 50 + 18 * Math.cos(t * 0.75 + 3.0);
      const b4x = 50 + 18 * Math.sin(t * 1.1 + 1.0);
      const b4y = 50 + 30 * Math.cos(t * 0.95 + 5.1);
      const b5x = 50 + 38 * Math.sin(t * 0.55 + 5.5);
      const b5y = 50 + 24 * Math.cos(t * 0.42 + 4.0);
      const b6x = 50 + 14 * Math.sin(t * 1.3 + 3.0);
      const b6y = 50 + 14 * Math.cos(t * 1.15 + 2.0);

      el.style.backgroundImage = [
        `radial-gradient(ellipse 48% 55% at ${b1x}% ${b1y}%, ${palette.highlight} 0%, ${palette.base} 45%, transparent 82%)`,
        `radial-gradient(ellipse 38% 46% at ${b2x}% ${b2y}%, ${palette.brightest} 0%, ${palette.highlight} 40%, transparent 80%)`,
        `radial-gradient(ellipse 32% 42% at ${b3x}% ${b3y}%, ${palette.bronze} 0%, transparent 78%)`,
        `radial-gradient(ellipse 28% 38% at ${b4x}% ${b4y}%, ${palette.deep} 0%, transparent 78%)`,
        `radial-gradient(ellipse 44% 52% at ${b5x}% ${b5y}%, ${palette.base} 0%, transparent 82%)`,
        `radial-gradient(ellipse 20% 26% at ${b6x}% ${b6y}%, ${palette.brightest} 0%, transparent 72%)`,
        `radial-gradient(ellipse 55% 65% at ${b3x}% ${b2y}%, color-mix(in srgb, ${palette.deep} 65%, ${palette.shadowMix}) 0%, transparent 58%)`,
        `radial-gradient(ellipse 42% 50% at ${b5x}% ${b4y}%, color-mix(in srgb, ${palette.deep} 45%, ${palette.shadowMix}) 0%, transparent 55%)`,
      ].join(", ");
    };

    const handleMediaChange = (e: MediaQueryListEvent) => {
      shouldReduceMotion = e.matches;
      if (shouldReduceMotion) {
        cancelAnimationFrame(frame);
        el.style.backgroundImage = staticFallback;
      } else {
        frame = requestAnimationFrame(animate);
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        paused = true;
        cancelAnimationFrame(frame);
      } else {
        paused = false;
        if (!shouldReduceMotion) frame = requestAnimationFrame(animate);
      }
    };

    mediaQuery.addEventListener("change", handleMediaChange);
    document.addEventListener("visibilitychange", onVisibility);

    const observer = new IntersectionObserver(
      ([entry]) => {
        offscreen = !entry.isIntersecting;
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);

    if (shouldReduceMotion) {
      el.style.backgroundImage = staticFallback;
    } else {
      frame = requestAnimationFrame(animate);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      mediaQuery.removeEventListener("change", handleMediaChange);
    };
  }, [palette]);

  return { ref, palette };
}
