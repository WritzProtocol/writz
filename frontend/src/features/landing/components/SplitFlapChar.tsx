"use client";

import { motion } from "framer-motion";
import { useSplitFlapChar } from "../hooks/useSplitFlapChar";

interface SplitFlapCharProps {
  char: string;
  index: number;
  animationKey: number;
  skipEntrance: boolean;
  speed: number;
  playClick?: () => void;
}

/** One flip-tile of the split-flap display (a Solari board character). */
export function SplitFlapChar({ char, index, animationKey, skipEntrance, speed, playClick }: SplitFlapCharProps) {
  const { currentChar, isSettled } = useSplitFlapChar({ char, index, animationKey, skipEntrance, speed, playClick });
  const isSpace = char === " ";
  const tileDelay = 0.15 * index;

  const bgColor = isSettled ? "var(--bg)" : "var(--card)";
  const textColor = isSettled ? "var(--text-hi)" : "var(--accent)";

  // The tile's font-size drives its width/height (both set in `em`), so this
  // one clamp() controls the whole board's scale. It must stay small enough
  // that all 14 tiles of "WRITZ PROTOCOL" (0.85em wide each) never exceed the
  // FinalCTA's max-w-4xl (896px) container — the max here (4rem) tops out
  // around ~755px total row width, comfortably inside that budget.
  const fontSizeClass = "text-[clamp(1.5rem,6vw,4rem)]";

  if (isSpace) {
    return <div className={fontSizeClass} style={{ width: "0.3em" }} />;
  }

  return (
    <motion.div
      initial={skipEntrance ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: tileDelay, duration: 0.3, ease: "easeOut" }}
      className={`relative overflow-hidden flex items-center justify-center ${fontSizeClass}`}
      style={{
        fontFamily: "var(--landing-font-sans)",
        width: "0.85em",
        height: "1.05em",
        backgroundColor: bgColor,
        transformStyle: "preserve-3d",
        transition: "background-color 0.15s ease",
        borderRadius: "0.15em",
        border: "1px solid var(--border)",
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-[1px] bg-black/20 pointer-events-none z-10" />

      <div className="absolute inset-x-0 top-0 bottom-1/2 flex items-end justify-center overflow-hidden">
        <span className="block translate-y-[0.52em] leading-none transition-colors duration-150" style={{ color: textColor }}>
          {currentChar}
        </span>
      </div>

      <div className="absolute inset-x-0 top-1/2 bottom-0 flex items-start justify-center overflow-hidden">
        <span className="-translate-y-[0.52em] leading-none transition-colors duration-150" style={{ color: textColor }}>
          {currentChar}
        </span>
      </div>

      <motion.div
        key={`${animationKey}-${isSettled}`}
        initial={{ rotateX: -90 }}
        animate={{ rotateX: 0 }}
        transition={{
          delay: skipEntrance ? tileDelay * 0.5 : tileDelay + 0.15,
          duration: 0.25,
          ease: [0.22, 0.61, 0.36, 1],
        }}
        className="absolute inset-x-0 top-0 bottom-1/2 origin-bottom overflow-hidden"
        style={{
          backgroundColor: bgColor,
          transformStyle: "preserve-3d",
          backfaceVisibility: "hidden",
          transition: "background-color 0.15s ease",
        }}
      >
        <div className="flex h-full items-end justify-center">
          <span className="translate-y-[0.52em] leading-none transition-colors duration-150" style={{ color: textColor }}>
            {currentChar}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
