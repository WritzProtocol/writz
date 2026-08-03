"use client";

import { useSplitFlapText } from "../hooks/useSplitFlapText";
import { useSplitFlapAudio } from "./SplitFlapAudioProvider";
import { SplitFlapChar } from "./SplitFlapChar";

interface SplitFlapTextProps {
  text: string;
  className?: string;
  speed?: number;
}

/** Solari split-flap board effect for a static line of text. Must be
 * rendered inside a <SplitFlapAudioProvider>. */
export function SplitFlapText({ text, className = "", speed = 50 }: SplitFlapTextProps) {
  const { chars, animationKey, hasInitialized, replay } = useSplitFlapText(text);
  const audio = useSplitFlapAudio();

  return (
    <div
      className={`inline-flex gap-[0.08em] items-center cursor-pointer ${className}`}
      aria-label={text}
      onMouseEnter={replay}
      style={{ perspective: "1000px" }}
    >
      {chars.map((char, index) => (
        <SplitFlapChar
          key={index}
          char={char.toUpperCase()}
          index={index}
          animationKey={animationKey}
          skipEntrance={hasInitialized}
          speed={speed}
          playClick={audio?.playClick}
        />
      ))}
    </div>
  );
}
