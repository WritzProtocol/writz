import type { CctpApi, CctpStatus } from "./cctp";
import { DEFAULT_SLIPPAGE_BP, minOutFor, type SwapApi } from "./swap";

/**
 * Harness implementations for the mock scenarios (`/dev/scenarios`, only with
 * NEXT_PUBLIC_UI_MOCK=1). They sign nothing and send nothing; the hashes are
 * fixtures.
 */

export interface MockReceiveOptions {
  /** XLM per USDC in the mock quote. */
  xlmPerUsdc?: number;
  failQuote?: boolean;
  failSwap?: boolean;
  failSend?: boolean;
  /** The CCTP status every poll answers. */
  cctp?: CctpStatus;
  delayMs?: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fixtureHash = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

export function mockSwapApi(o: MockReceiveOptions = {}): SwapApi {
  const delay = o.delayMs ?? 600;
  return {
    async quote(usdcStroops) {
      await wait(delay);
      if (o.failQuote) throw new Error("mock: quote unavailable");
      const out = (usdcStroops * BigInt(Math.round((o.xlmPerUsdc ?? 3.2) * 10_000))) / 10_000n;
      return {
        amountInStroops: usdcStroops,
        amountOutStroops: out,
        minOutStroops: minOutFor(out, DEFAULT_SLIPPAGE_BP),
        slippageBp: DEFAULT_SLIPPAGE_BP,
        quotedAt: Date.now(),
      };
    },
    async execute() {
      await wait(delay * 2);
      if (o.failSwap) throw new Error("mock: the swap returned less than the minimum");
      return { hash: fixtureHash(0x5a) };
    },
  };
}

export function mockCctpApi(o: MockReceiveOptions = {}): CctpApi {
  const delay = o.delayMs ?? 600;
  return {
    async send() {
      await wait(delay * 2);
      if (o.failSend) throw new Error("mock: burn rejected");
      return { burnHash: fixtureHash(0xcc) };
    },
    async status() {
      await wait(delay);
      return o.cctp ?? { kind: "confirming" };
    },
  };
}
