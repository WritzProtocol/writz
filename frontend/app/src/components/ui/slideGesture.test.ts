import { describe, expect, test } from "bun:test";
import { endDrag, moveDrag, startDrag } from "./slideGesture";

const MAX = 300;

function dragTo(clientX: number) {
  return moveDrag(startDrag(10, 0, MAX), clientX);
}

describe("slide to confirm gesture", () => {
  test("a pointerup past the threshold confirms", () => {
    expect(endDrag(dragTo(10 + MAX), "up")).toEqual({ confirm: true, x: MAX });
    expect(endDrag(dragTo(10 + MAX * 0.9), "up").confirm).toBe(true);
  });

  test("a pointerup short of the threshold springs back", () => {
    expect(endDrag(dragTo(10 + MAX * 0.89), "up")).toEqual({ confirm: false, x: 0 });
  });

  test("a cancelled pointer never confirms, even at the end of the track", () => {
    expect(endDrag(dragTo(10 + MAX), "cancel")).toEqual({ confirm: false, x: 0 });
    expect(endDrag(dragTo(10 + MAX * 2), "cancel")).toEqual({ confirm: false, x: 0 });
  });

  test("the handle stays inside the track", () => {
    expect(dragTo(-500).x).toBe(0);
    expect(dragTo(5000).x).toBe(MAX);
  });

  test("a track with no room never confirms", () => {
    expect(endDrag(moveDrag(startDrag(0, 0, 0), 100), "up").confirm).toBe(false);
  });
});
