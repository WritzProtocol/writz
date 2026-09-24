"use client";

import { useInView } from "framer-motion";
import { useRef } from "react";

const CHART_POINTS = [
  { x: 0, y: 60 },
  { x: 20, y: 45 },
  { x: 40, y: 55 },
  { x: 60, y: 30 },
  { x: 80, y: 40 },
  { x: 100, y: 15 },
];

export function AnimatedChart() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const pathD = CHART_POINTS.reduce(
    (acc, point, i) => (i === 0 ? `M ${point.x} ${point.y}` : `${acc} L ${point.x} ${point.y}`),
    "",
  );

  return (
    <svg ref={ref} viewBox="0 0 100 70" className="w-full h-24">
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {isInView && (
        <>
          <path d={`${pathD} L 100 70 L 0 70 Z`} fill="url(#chartGradient)" className="opacity-70" />
          <path
            d={pathD}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            className="draw-line"
          />
        </>
      )}
    </svg>
  );
}
