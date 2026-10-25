import { config } from "@/config";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import { fetchAttestation, sendUsdcToChain } from "./cctp";
import type { ReceiveApis } from "./index";
import { DEFAULT_SLIPPAGE_BP, minOut, quoteUsdcToXlm, swapUsdcToXlm } from "./swap";

/**
 * The receive-as interfaces on the real transactions: the Soroswap swap and
 * the CCTP burn, signed by the borrower's wallet. An option whose contracts
 * this deployment does not name stays null, which hides it. The timeline
 * stays on this device's data until the relayer serves one.
 */
export function liveReceiveApis(signTransaction: SignTransaction): ReceiveApis {
  const r = config.receive;
  const swap: ReceiveApis["swap"] =
    r.soroswapRouter && r.xlmToken && config.contracts.usdcToken
      ? {
          async quote(usdcStroops) {
            const out = await quoteUsdcToXlm(usdcStroops);
            return {
              amountInStroops: usdcStroops,
              amountOutStroops: out,
              minOutStroops: minOut(out, DEFAULT_SLIPPAGE_BP),
              slippageBp: DEFAULT_SLIPPAGE_BP,
              quotedAt: Date.now(),
            };
          },
          async execute(quote, owner) {
            const { hash } = await swapUsdcToXlm({ owner, amountIn: quote.amountInStroops, slippageBp: quote.slippageBp, signTransaction });
            return { hash };
          },
        }
      : null;
  const cctp: ReceiveApis["cctp"] =
    r.cctp.tokenMessengerMinter && config.contracts.usdcToken
      ? {
          async send(usdcStroops, to, owner) {
            const { burnHash } = await sendUsdcToChain({ owner, amountStroops: usdcStroops, recipient: to, signTransaction });
            return { burnHash };
          },
          async status(burnHash) {
            // Circle's confirmation; the mint on Base Sepolia is reported by the relay once it serves it.
            const a = await fetchAttestation(burnHash);
            return a.status === "complete" ? { kind: "confirmed" } : { kind: "confirming" };
          },
        }
      : null;
  return { swap, cctp, timeline: null };
}
