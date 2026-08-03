"use client";

import { useEffect, useRef, useState } from "react";
import type { SplitFlapCharState } from "../types/splitFlap.types";

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

interface UseSplitFlapCharOptions {
  char: string;
  index: number;
  animationKey: number;
  skipEntrance: boolean;
  speed: number;
  playClick?: () => void;
}

/** Runs the slot-machine "flip until settled" state machine for one tile. */
export function useSplitFlapChar({
  char,
  index,
  animationKey,
  skipEntrance,
  speed,
  playClick,
}: UseSplitFlapCharOptions): SplitFlapCharState {
  const displayChar = CHARSET.includes(char) ? char : " ";
  const isSpace = char === " ";

  const [currentChar, setCurrentChar] = useState(skipEntrance ? displayChar : " ");
  const [isSettled, setIsSettled] = useState(skipEntrance);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tileDelay = 0.15 * index;

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // Space tiles never render this hook's state (the caller returns its own
    // spacer element for them — see SplitFlapChar), so there's nothing to
    // synchronize; just skip the flip machinery.
    if (isSpace) return;

    // This effect *is* the subscription to an external system (the flip
    // timers below): every time a dependency changes it must reset the tile
    // to "flipping" and kick off a fresh setInterval sequence. That reset
    // can't be modeled as derived state — it's the setup step for the timer
    // this effect owns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSettled(false);
    setCurrentChar(CHARSET[Math.floor(Math.random() * CHARSET.length)]);

    const baseFlips = 8;
    const startDelay = skipEntrance ? tileDelay * 400 : tileDelay * 800;
    let flipIndex = 0;
    let hasStartedSettling = false;

    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        const settleThreshold = baseFlips + index * 3;

        if (flipIndex >= settleThreshold && !hasStartedSettling) {
          hasStartedSettling = true;
          if (intervalRef.current) clearInterval(intervalRef.current);
          setCurrentChar(displayChar);
          setIsSettled(true);
          playClick?.();
          return;
        }
        setCurrentChar(CHARSET[Math.floor(Math.random() * CHARSET.length)]);
        if (flipIndex % 2 === 0) playClick?.();
        flipIndex++;
      }, speed);
    }, startDelay);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [displayChar, isSpace, tileDelay, animationKey, skipEntrance, index, speed, playClick]);

  return { currentChar, isSettled };
}
