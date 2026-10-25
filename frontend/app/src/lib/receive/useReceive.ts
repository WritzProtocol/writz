"use client";

import { useCallback, useEffect, useState } from "react";
import type { FlowState } from "@/lib/flow/engine";
import { useFlow } from "@/lib/flow/useFlow";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { fetchAttestation, sendUsdcToChain, type SendResult } from "./cctp";
import { DEFAULT_SLIPPAGE_BP, quoteUsdcToXlm, swapUsdcToXlm, type SwapResult } from "./swap";

/** Where the borrowed USDC ends up. */
export type ReceiveAs = "usdc" | "xlm" | "chain";

export type XlmQuote =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; amountIn: bigint; xlmOut: bigint }
  | { kind: "failed" };

const QUOTE_DEBOUNCE_MS = 400;
const QUOTE_REFRESH_MS = 15_000;
const ATTESTATION_POLL_MS = 5_000;

/** A live USDC to XLM quote for `amountIn` stroops, debounced and refreshed while shown. */
export function useXlmQuote(amountIn: bigint | null): XlmQuote {
  const [quote, setQuote] = useState<{ amountIn: bigint; value: XlmQuote } | null>(null);
  const wanted = amountIn && amountIn > 0n ? amountIn : null;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const load = () =>
      quoteUsdcToXlm(wanted)
        .then((xlmOut) => live && setQuote({ amountIn: wanted, value: { kind: "ok", amountIn: wanted, xlmOut } }))
        .catch(() => live && setQuote({ amountIn: wanted, value: { kind: "failed" } }));
    const first = setTimeout(load, QUOTE_DEBOUNCE_MS);
    const every = setInterval(load, QUOTE_REFRESH_MS);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(every);
    };
  }, [wanted]);
  if (!wanted) return { kind: "idle" };
  return quote?.amountIn === wanted ? quote.value : { kind: "checking" };
}

/** The other-chain leg after the burn: "Sent from Stellar", then "Circle confirms"; the relay reports "Arrived". */
export type ChainLeg =
  | { kind: "idle" }
  | { kind: "sent"; send: SendResult; recipient: string }
  | { kind: "confirmed"; send: SendResult; recipient: string; message: string; attestation: string };

export interface ReceiveModel {
  flow: FlowState;
  swap: SwapResult | null;
  leg: ChainLeg;
  /** Swap `amountIn` stroops of USDC already in the wallet for XLM. */
  toXlm: (amountIn: bigint, slippageBp?: number) => Promise<void>;
  /** Send `amount` stroops of USDC to `recipient` (0x...) on the destination chain. */
  toChain: (amount: bigint, recipient: string) => Promise<void>;
}

export function useReceive(): ReceiveModel {
  const { address, signTransaction } = useWallet();
  const [flow, emit] = useFlow();
  const [swap, setSwap] = useState<SwapResult | null>(null);
  const [leg, setLeg] = useState<ChainLeg>({ kind: "idle" });

  const toXlm = useCallback(
    async (amountIn: bigint, slippageBp = DEFAULT_SLIPPAGE_BP) => {
      if (!address) return;
      emit({ type: "start" });
      try {
        setSwap(await swapUsdcToXlm({ owner: address, amountIn, slippageBp, signTransaction, emit }));
      } catch (error) {
        emit({ type: "failed", error });
      }
    },
    [address, signTransaction, emit],
  );

  const toChain = useCallback(
    async (amount: bigint, recipient: string) => {
      if (!address) return;
      emit({ type: "start" });
      try {
        const send = await sendUsdcToChain({ owner: address, amountStroops: amount, recipient, signTransaction, emit });
        setLeg({ kind: "sent", send, recipient });
      } catch (error) {
        emit({ type: "failed", error });
      }
    },
    [address, signTransaction, emit],
  );

  const sentHash = leg.kind === "sent" ? leg.send.burnHash : null;
  useEffect(() => {
    if (!sentHash) return;
    let live = true;
    const poll = async () => {
      const a = await fetchAttestation(sentHash).catch(() => null);
      if (!live || a?.status !== "complete") return;
      const { message, attestation } = a;
      setLeg((l) =>
        l.kind === "sent" && l.send.burnHash === sentHash
          ? { kind: "confirmed", send: l.send, recipient: l.recipient, message, attestation }
          : l,
      );
    };
    void poll();
    const every = setInterval(poll, ATTESTATION_POLL_MS);
    return () => {
      live = false;
      clearInterval(every);
    };
  }, [sentHash]);

  return { flow, swap, leg, toXlm, toChain };
}
