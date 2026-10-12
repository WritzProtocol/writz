"use client";

import { useState } from "react";
import { IDLE } from "@/lib/flow/engine";
import type { Read } from "@/lib/loan/model";
import type { MockWorld, Reading } from "@/lib/mock/types";
import { earnSides, UNIT, type EarnModel } from "./model";

const noop = () => {};
const MOCK_AMOUNT = 1_000_000_000n;

const read = <T,>(r: Reading<T> | undefined): Read<T> =>
  !r || r.state === "loading" ? { kind: "checking" } : r.state === "failed" ? { kind: "failed" } : { kind: "ok", value: r.value };

/** Earn as a harness scenario describes it. Actions do nothing. */
export function useMockEarn(world: MockWorld): EarnModel {
  const [now] = useState(() => Date.now());
  const e = world.earn;
  const sw = world.wallets.stellar;
  const balance = read(e?.vaultStroops);
  const wallet = read(e?.walletStroops);
  const trustline = read(e?.trustline);
  const apy = read(e?.apy);
  const earned = read(e?.earnedStroops);
  const stale = e?.vaultStroops.state === "failed" && e.vaultStroops.lastGood !== undefined ? { value: e.vaultStroops.lastGood, at: e.vaultStroops.at ?? now } : null;
  const flowKind = world.flow?.kind;
  const action = flowKind === "earn_deposit" ? "in" : flowKind === "earn_withdraw" ? "out" : null;
  const paused = Boolean(e?.strategyPaused);

  return {
    connected: Boolean(sw),
    connecting: false,
    connect: noop,
    walletName: "Freighter",
    wrongNetwork: sw?.network === "PUBLIC" ? "Stellar mainnet" : null,
    unfunded: Boolean(sw) && sw?.xlmStroops === null,
    apy: { value: apy.kind === "ok" ? apy.value : null, at: now, failed: apy.kind === "failed" },
    balance,
    earned: earned.kind === "ok" ? earned.value : null,
    stale,
    retry: noop,
    wallet,
    paused,
    funds: sw
      ? {
          unit: UNIT,
          walletName: "Freighter",
          sides: earnSides(wallet, balance, paused),
          defaultSide: "in",
          trustline,
          trust: {
            text: `Add ${UNIT} to your wallet. One signature. Your wallet sets aside 0.5 XLM.`,
            button: `Add ${UNIT}`,
            busy: false,
            error: null,
            add: noop,
          },
          flow: action ? world.flow!.state : IDLE,
          action,
          lastAmount: action ? MOCK_AMOUNT : null,
          otherTx: Boolean(world.globals.otherTabTx),
          submit: noop,
          dismiss: noop,
          checkAgain: noop,
        }
      : null,
  };
}
