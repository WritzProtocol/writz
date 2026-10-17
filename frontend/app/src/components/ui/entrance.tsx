"use client";

import { useEffect, useState, type AnimationEvent, type CSSProperties, type HTMLAttributes } from "react";
import { usePathname } from "next/navigation";
import { createEntranceClock } from "./entranceClock";

export type EntranceKind = "in" | "open";

/** A panel's children rise until 1060ms and a meter inside it lands at 1230ms. */
const SPAN = 1300;
const NAMES = new Set(["wz-cut", "wz-up", "ln-grow", "ln-drop"]);

const clock = createEntranceClock();

function claim(path: string, key: string): number {
  return typeof window === "undefined" ? 0 : clock(path, key, performance.now());
}

function entering(el: Element): boolean {
  if (typeof el.getAnimations !== "function") return false;
  return el
    .getAnimations({ subtree: true })
    .some((a) => typeof CSSAnimation !== "undefined" && a instanceof CSSAnimation && NAMES.has(a.animationName) && a.playState !== "finished");
}

export interface EntranceProps {
  className?: string;
  style?: CSSProperties;
  onAnimationEnd?: (e: AnimationEvent<HTMLElement>) => void;
}

/**
 * Plays an element's route entrance once per visit to the route, however often it re-renders or remounts.
 * `in` rises a section (`step` staggers it), `open` sweeps a cut-corner panel; `ready` defers it until the element first shows.
 */
export function useEntrance(key: string, kind: EntranceKind, { step = 1, ready = true }: { step?: 1 | 2 | 3 | 4; ready?: boolean } = {}) {
  const path = usePathname();
  const [skip, setSkip] = useState<number | "wait" | "done">(() => (ready ? claim(path, key) : "wait"));
  if (ready && skip === "wait") setSkip(claim(path, key));
  const playing = typeof skip === "number" && skip < SPAN;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setSkip("done"), 2 * SPAN);
    return () => clearTimeout(t);
  }, [playing]);

  const cls = !playing ? "" : kind === "open" ? "wz-open" : step > 1 ? `wz-in wz-in${step}` : "wz-in";
  const onAnimationEnd = (e: AnimationEvent<HTMLElement>) => {
    if (NAMES.has(e.animationName) && !entering(e.currentTarget)) setSkip("done");
  };

  return (className?: string, style?: CSSProperties): EntranceProps => ({
    className: [className, cls].filter(Boolean).join(" ") || undefined,
    style: playing && skip > 16 ? ({ ...style, "--wz-skip": `${-Math.round(skip)}ms` } as CSSProperties) : style,
    onAnimationEnd: playing ? onAnimationEnd : undefined,
  });
}

type EnterProps = HTMLAttributes<HTMLElement> & {
  name: string;
  kind?: EntranceKind;
  step?: 1 | 2 | 3 | 4;
  ready?: boolean;
  as?: "div" | "section" | "dl" | "header" | "aside";
};

/** An element with its route entrance, for markup rendered conditionally. */
export function Enter({ name, kind = "in", step, ready, as: Tag = "div", className, style, ...rest }: EnterProps) {
  const enter = useEntrance(name, kind, { step, ready });
  return <Tag {...rest} {...enter(className, style)} />;
}
