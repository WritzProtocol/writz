"use client";

import { useState } from "react";
import { copy } from "./styles";

export function CopyButton({ text, className = copy }: { text: string; className?: string }) {

  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
