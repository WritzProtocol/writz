"use client";

import { useState } from "react";
import { IDLE } from "@/lib/flow/engine";
import { formatUsdc } from "@/lib/borrow/journey";
import type { Read } from "@/lib/loan/model";
import type { MockWorld, Reading } from "@/lib/mock/types";
import { lendSides, type LendModel } from "./model";

const noop = () => {};
const MOCK_AMOUNT = 1_000_000_000n;
const ONE = 10_000_000n;

const read = <T,>(r: Reading<T> | undefined): Read<T> =>
  !r || r.state === "loading" ? { kind: "checking" } : r.state === "failed" ? { kind: "failed" } : { kind: "ok", value: r.value };

/** Lend as a harness scenario describes it. Actions do nothing. */
export function useMockLend(world: MockWorld): LendModel {
  const [now] = useState(() => Date.now());
  const l = world.lend;
  const sw = world.wallets.stellar;
  const pool = read(l?.pool);
  const supplied = read(l?.suppliedStroops);
  const wallet = read(l?.walletUsdcStroops);
  const kind = world.flow?.kind;
  const action = kind === "supply" ? "in" : kind === "withdraw" ? "out" : null;
  const s = l?.suppliedStroops;
  const p = l?.pool;
  const stale =
    s?.state === "failed" && s.lastGood !== undefined && p?.state === "failed" && p.lastGood !== undefined
      ? { supplied: s.lastGood, pool: p.lastGood, at: s.at ?? now }
      : null;
  const initial =
    l?.inputError === "over_wallet" && wallet.kind === "ok"
      ? { side: "in" as const, value: formatUsdc(wallet.value + ONE) }
      : l?.inputError === "over_supply" && supplied.kind === "ok"
        ? { side: "out" as const, value: formatUsdc(supplied.value + ONE) }
        : undefined;

  return {
    connected: Boolean(sw),
    connecting: false,
    connect: noop,
    walletName: "Freighter",
    wrongNetwork: sw?.network === "PUBLIC" ? "Stellar mainnet" : null,
    unfunded: Boolean(sw) && sw?.xlmStroops === null,
    pool: stale ? { kind: "ok", value: stale.pool } : pool,
    supplied: stale ? { kind: "ok", value: stale.supplied } : supplied,
    stale,
    retry: noop,
    funds: sw
      ? {
          unit: "USDC",
          walletName: "Freighter",
          sides: lendSides(wallet, supplied, pool, initial),
          defaultSide: initial?.side ?? (action === "out" ? "out" : "in"),
          trustline: read(l?.trustline),
          trust: {
            text: "Add USDC to your Stellar wallet. One signature. Your wallet sets aside 0.5 XLM.",
            button: "Add USDC",
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
