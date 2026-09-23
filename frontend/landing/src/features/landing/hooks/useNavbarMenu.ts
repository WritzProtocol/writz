"use client";

import { useCallback, useState } from "react";

export function useNavbarMenu() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleMouseEnter = useCallback((index: number) => setHoveredIndex(index), []);
  const handleMouseLeave = useCallback(() => setHoveredIndex(null), []);
  const toggleMobileMenu = useCallback(() => setIsMobileMenuOpen((open) => !open), []);
  const closeMobileMenu = useCallback(() => setIsMobileMenuOpen(false), []);

  return {
    hoveredIndex,
    isMobileMenuOpen,
    handleMouseEnter,
    handleMouseLeave,
    toggleMobileMenu,
    closeMobileMenu,
  };
}
