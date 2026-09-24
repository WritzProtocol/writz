"use client";

import { useAnimatedCounter } from "../hooks/useAnimatedCounter";

interface AnimatedCounterProps {
  value: number;
  suffix?: string;
}

export function AnimatedCounter({ value, suffix = "" }: AnimatedCounterProps) {
  const ref = useAnimatedCounter(value, suffix);
  return (
    <span ref={ref}>
      0{suffix}
    </span>
  );
}
