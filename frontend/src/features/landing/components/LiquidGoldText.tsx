"use client";

import type { CSSProperties, ReactNode } from "react";
import { useLiquidGoldAnimation } from "../hooks/useLiquidGoldAnimation";
import type { LiquidGoldTone } from "../types/liquidGoldText.types";

interface LiquidGoldTextProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  tone?: LiquidGoldTone;
}

/** Animated "liquid metal" text - background-clip:text over a drifting
 * radial-gradient blob field, driven by useLiquidGoldAnimation. */
export function LiquidGoldText({ children, className = "", style, tone = "gold" }: LiquidGoldTextProps) {
  const { ref, palette } = useLiquidGoldAnimation(tone);

  return (
    <span
      ref={ref}
      className={className}
      style={{
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        backgroundColor: palette.base,
        willChange: "background-image",
        filter: palette.dropShadow,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
