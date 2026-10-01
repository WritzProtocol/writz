"use client";

import { useEffect } from "react";

const STAGGER_MS = 80;
const REVEAL_MS = 420;

export function ScrollReveal() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".landing");
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));

    // Siblings reveal in sequence, so a row of cards reads left to right.
    for (const el of items) {
      const siblings = Array.from(el.parentElement?.children ?? []).filter((c) => c.hasAttribute("data-reveal"));
      el.style.transitionDelay = `${siblings.indexOf(el) * STAGGER_MS}ms`;
    }

    // Once landed, hand the element's transitions back to its own styles.
    const settle = (el: HTMLElement) => {
      el.classList.add("settled");
      el.style.transitionDelay = "";
    };
    const reveal = (el: HTMLElement) => {
      el.classList.add("in");
      window.setTimeout(() => settle(el), REVEAL_MS + parseFloat(el.style.transitionDelay || "0"));
    };

    // Anything already on screen stays visible, so a reload mid-page does not flash.
    for (const el of items) {
      if (el.getBoundingClientRect().top < window.innerHeight) {
        el.classList.add("in");
        settle(el);
      }
    }
    root.classList.add("reveal-ready");

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          reveal(e.target as HTMLElement);
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    for (const el of items) if (!el.classList.contains("in")) io.observe(el);
    return () => io.disconnect();
  }, []);

  return null;
}
