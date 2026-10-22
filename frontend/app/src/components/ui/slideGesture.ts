export const CONFIRM_AT = 0.9;

export type SlideDrag = { start: number; max: number; x: number };

export type SlideEnd = "up" | "cancel";

export function startDrag(clientX: number, x: number, max: number): SlideDrag {
  return { start: clientX - x, max, x };
}

export function moveDrag(drag: SlideDrag, clientX: number): SlideDrag {
  return { ...drag, x: Math.min(drag.max, Math.max(0, clientX - drag.start)) };
}

/** Only a pointerup past the threshold confirms; a cancelled or lost pointer always resets. */
export function endDrag(drag: SlideDrag, how: SlideEnd): { confirm: boolean; x: number } {
  const confirm = how === "up" && drag.max > 0 && drag.x >= drag.max * CONFIRM_AT;
  return { confirm, x: confirm ? drag.max : 0 };
}
