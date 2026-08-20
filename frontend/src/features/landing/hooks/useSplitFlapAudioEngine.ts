"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { SplitFlapAudioContextValue } from "../types/splitFlap.types";

/**
 * Encapsulates the WebAudio "click" synth used by the split-flap animation.
 * Muted by default - nothing plays until the caller opts in via toggleMute.
 */
export function useSplitFlapAudioEngine(): SplitFlapAudioContextValue {
  const [isMuted, setIsMuted] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);

  const getAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        audioContextRef.current = new AudioContextClass();
      }
    }
    return audioContextRef.current;
  }, []);

  const triggerHaptic = useCallback(() => {
    if (isMuted) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(10);
    }
  }, [isMuted]);

  const playClick = useCallback(() => {
    if (isMuted) return;

    triggerHaptic();

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const lowpass = ctx.createBiquadFilter();

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(800 + Math.random() * 400, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.015);

      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1200, ctx.currentTime);
      filter.Q.setValueAtTime(0.8, ctx.currentTime);

      lowpass.type = "lowpass";
      lowpass.frequency.value = 2500;
      lowpass.Q.value = 0.5;

      gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.02);

      oscillator.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(lowpass);
      lowpass.connect(ctx.destination);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.02);
    } catch {
      // Audio not supported in this environment - fail silently.
    }
  }, [isMuted, getAudioContext, triggerHaptic]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume();
      }
    } catch {
      // Audio not supported in this environment - fail silently.
    }
  }, [getAudioContext]);

  return useMemo(() => ({ isMuted, toggleMute, playClick }), [isMuted, toggleMute, playClick]);
}
