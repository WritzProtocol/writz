import type { LiquidGoldPalette, LiquidGoldTone } from "../types/liquidGoldText.types";

export const liquidGoldPalettes: Record<LiquidGoldTone, LiquidGoldPalette> = {
  gold: {
    deep: "#7a5c14",
    bronze: "#B8860B",
    base: "#D4AF37",
    highlight: "#FFE9A8",
    brightest: "#FFFDF5",
    shadowMix: "black",
    dropShadow: "drop-shadow(0 0 2px rgba(255, 233, 168, 0.35)) drop-shadow(0 0 6px rgba(212, 175, 55, 0.18))",
  },
  silver: {
    deep: "#9a9aa4",
    bronze: "#c4c4cc",
    base: "#e8e8ec",
    highlight: "#ffffff",
    brightest: "#ffffff",
    shadowMix: "#6b6b74",
    dropShadow: "drop-shadow(0 0 2px rgba(255, 255, 255, 0.3)) drop-shadow(0 0 6px rgba(200, 200, 210, 0.15))",
  },
};
