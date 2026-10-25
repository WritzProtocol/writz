import type { CctpApi } from "./cctp";
import type { SwapApi } from "./swap";
import type { TimelineApi } from "./timeline";

export * from "./options";
export * from "./swap";
export * from "./cctp";
export * from "./stepper";
export * from "./timeline";

/**
 * The live implementations. Null hides the option in the build: the XLM
 * swap and the CCTP transfer land here when their transaction code is in
 * (`liveSwapApi`, `liveCctpApi`), and the timeline when the relayer serves
 * it. The mock harness passes its own through the loan model instead.
 */
export const LIVE_SWAP: SwapApi | null = null;
export const LIVE_CCTP: CctpApi | null = null;
export const LIVE_TIMELINE: TimelineApi | null = null;

export interface ReceiveApis {
  swap: SwapApi | null;
  cctp: CctpApi | null;
  timeline: TimelineApi | null;
}

export const LIVE_RECEIVE: ReceiveApis = { swap: LIVE_SWAP, cctp: LIVE_CCTP, timeline: LIVE_TIMELINE };
