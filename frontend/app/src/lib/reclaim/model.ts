export type ReclaimWindow =
  | { kind: "unknown" }
  | { kind: "future"; blocksLeft: number }
  | { kind: "reached" };

/** Where the chain stands against a loan's timelock block. CLTV accepts the block itself. */
export function reclaimWindow(height: number, tip: number | null): ReclaimWindow {
  if (tip === null) return { kind: "unknown" };
  return tip >= height ? { kind: "reached" } : { kind: "future", blocksLeft: height - tip };
}
