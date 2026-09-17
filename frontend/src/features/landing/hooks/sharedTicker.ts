/**
 * A single shared `requestAnimationFrame` loop that every
 * `useLiquidGoldAnimation` instance subscribes to, instead of each calling
 * `requestAnimationFrame` independently.
 *
 * The landing page renders up to ~9 `<LiquidGoldText>` instances at once
 * (Hero, Navbar, FinalCTA) - that's up to 9 independent rAF registrations
 * competing for the same per-frame budget. Consolidating into one rAF
 * registration doesn't reduce the actual per-frame work, but it removes
 * the browser's per-callback scheduling overhead and keeps all of it
 * running in a predictable order within a single frame instead of as
 * separate, independently-scheduled macrotasks.
 */
type TickCallback = (time: number) => void;

const callbacks = new Set<TickCallback>();
let frameId: number | null = null;

function loop(time: number) {
  frameId = requestAnimationFrame(loop);
  for (const cb of callbacks) cb(time);
}

/** Subscribes `cb` to run once per frame. Returns an unsubscribe function -
 * call it on cleanup, same as `cancelAnimationFrame` would be. The shared
 * loop itself only runs while at least one subscriber is registered. */
export function subscribeTick(cb: TickCallback): () => void {
  callbacks.add(cb);
  if (frameId === null) {
    frameId = requestAnimationFrame(loop);
  }
  return () => {
    callbacks.delete(cb);
    if (callbacks.size === 0 && frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };
}
