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

    // A direct load of /#id lands on the target's resting place, like a clicked anchor.
    const hashed = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
    if (hashed?.hasAttribute("data-reveal")) {
      hashed.classList.add("in");
      settle(hashed);
    }

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

    // The browser's own smooth jump to the fragment was measured before fonts settled and keeps
    // going after ours, so land again when it ends, unless the reader has taken over.
    let taken = false;
    const take = () => {
      taken = true;
    };
    const land = () => {
      if (hashed && !taken) hashed.scrollIntoView({ block: "start", behavior: "instant" });
    };
    const INPUTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const t of INPUTS) window.addEventListener(t, take, { passive: true, once: true });
    land();
    if (hashed) window.addEventListener("scrollend", land, { once: true });
    const stopLanding = window.setTimeout(() => window.removeEventListener("scrollend", land), 2000);

    // An anchor jump lands on the target's resting place, not on its offset before the reveal.
    const onClick = (e: MouseEvent) => {
      const href = (e.target as Element | null)?.closest("a")?.getAttribute("href") ?? "";
      const id = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
      const el = id ? document.getElementById(id) : null;
      if (!el?.hasAttribute("data-reveal") || el.classList.contains("in")) return;
      io.unobserve(el);
      el.classList.add("in");
      settle(el);
    };
    root.addEventListener("click", onClick, true);
    return () => {
      io.disconnect();
      root.removeEventListener("click", onClick, true);
      window.clearTimeout(stopLanding);
      window.removeEventListener("scrollend", land);
      for (const t of INPUTS) window.removeEventListener(t, take);
    };
  }, []);

  return null;
}
