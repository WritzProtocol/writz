"use client";

import type { ReactNode } from "react";
import { useSmoothScroll } from "../hooks/useSmoothScroll";

export function SmoothScroll({ children }: { children: ReactNode }) {
  useSmoothScroll();
  return children;
}
