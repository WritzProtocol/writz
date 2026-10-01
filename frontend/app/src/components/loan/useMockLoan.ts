"use client";

import { useState } from "react";
import { IDLE } from "@/lib/flow/engine";
import { loanActivity, type LoanTab, type Read } from "@/lib/loan/model";
import type { MockWorld, Reading } from "@/lib/mock/types";
import { usePositionStatus } from "@/lib/status/provider";
import { useSteadyStatus, type LoanAccess, type LoanModel } from "./model";

const noop = () => {};

const read = <T,>(r: Reading<T> | undefined): Read<T> =>
  !r || r.state === "loading" ? { kind: "checking" } : r.state === "failed" ? { kind: "failed" } : { kind: "ok", value: r.value };

const FLOW_TABS: ReadonlySet<string> = new Set(["borrow", "repay", "release"]);

/** The loan page as a harness scenario describes it. Actions that would reach a wallet or the network do nothing. */
export function useMockLoan(world: MockWorld, n: number): LoanModel {
  const [now] = useState(() => Date.now());
  const sw = world.wallets.stellar;
  const bw = world.wallets.bitcoin;
  const access: LoanAccess = !sw ? "disconnected" : sw.loans === "unsigned" ? "locked" : sw.loans === "finding" ? "finding" : "ready";

  const hit = world.positions.find((p) => p.local.position && p.local.position.index === n - 1);
  const position = access === "ready" ? (hit?.local.position ?? null) : null;
  const local = position && hit ? hit.local : null;
  const status = useSteadyStatus(usePositionStatus(local), position ? String(position.index) : null);

  const page = world.loan;
  const flow = world.flow && FLOW_TABS.has(world.flow.kind) ? world.flow.state : IDLE;
  const action = world.flow && FLOW_TABS.has(world.flow.kind) ? (world.flow.kind as LoanTab) : null;
  const price = world.chain.oraclePriceStroops;

  return {
    n,
    access,
    stellar: {
      walletName: "Freighter",
      connecting: false,
      connect: noop,
      keysReady: true,
      unlocking: false,
      unlockError: null,
      unlock: noop,
    },
    position,
    depositInProgress: Boolean(world.positions.find((p) => p.local.pendingDeposit?.positionIndex === n - 1)),
    status,
    price: price === undefined ? { kind: "failed" } : { kind: "ok", value: price },
    pool: read(page?.poolAvailableStroops),
    trustline: read(page?.trustline),
    walletUsdc: read(page?.walletUsdcStroops),
    bitcoin: {
      address: bw?.address ?? null,
      pubkey: bw?.pubkey ?? null,
      connecting: false,
      error: null,
      connect: noop,
      useOther: noop,
    },
    releaseFeeSats: 300,
    flow,
    action,
    lastAmount: null,
    trust: { busy: false, error: null, add: noop },
    otherTx: Boolean(world.globals.otherTabTx),
    catchingUp: status.syncing || Boolean(world.globals.relayerCatchingUp),
    activity: position
      ? loanActivity({
          index: position.index,
          pending: world.activity.map((t) =>
            t.positionUpdate ? t : { ...t, positionUpdate: { removeId: position.id, save: position } },
          ),
          recent: [],
          stellarTxHash: position.stellarTxHash,
          releaseTxid: position.releaseTxid,
          createdAt: position.createdAt,
        })
      : [],
    requestedPanel: page?.panel ?? null,
    now,
    borrow: noop,
    repay: noop,
    release: noop,
    dismiss: noop,
    recheckPrice: noop,
    checkAgain: noop,
    importBackup: noop,
    importState: { busy: false, error: null, done: false },
  };
}
