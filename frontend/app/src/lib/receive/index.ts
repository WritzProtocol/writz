import type { CctpApi } from "./cctpApi";
import type { SwapApi } from "./swapApi";
import type { TimelineApi } from "./timeline";

export * from "./options";
export * from "./swapApi";
export * from "./cctpApi";
export * from "./stepper";
export * from "./timeline";

/**
 * The implementations the loan page uses: `liveReceiveApis` (./live) in the
 * app, the mocks (./mock) in the harness. A null API hides its option.
 */
export interface ReceiveApis {
  swap: SwapApi | null;
  cctp: CctpApi | null;
  timeline: TimelineApi | null;
}
