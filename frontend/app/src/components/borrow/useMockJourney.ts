"use client";

import { useState } from "react";
import { config } from "@/config";
import { IDLE } from "@/lib/flow/engine";
import { LOCK_ADDRESS, TIMELOCK } from "@/lib/mock/fixtures";
import type { MockWorld } from "@/lib/mock/types";
import { usePositionStatus } from "@/lib/status/provider";
import {
  depositStage,
  estimateFeeSats,
  exitDate,
  formatBtc,
  fundingOf,
  LOW_XLM_STROOPS,
  parseBtcAmount,
  TIMELOCK_MIN_BLOCKS_LEFT,
  type Funding,
} from "@/lib/borrow/journey";
import { confirmedSats, route, useJourneyUi, type JourneyModel, type TxidCheck } from "./model";

const noop = () => {};

function mockFunding(xlmStroops: bigint | null): Funding {
  if (xlmStroops === null) return fundingOf(null);
  const whole = xlmStroops / 10_000_000n;
  const frac = (xlmStroops % 10_000_000n).toString().padStart(7, "0");
  return xlmStroops >= LOW_XLM_STROOPS ? { kind: "ok" } : fundingOf({ balances: [{ asset_type: "native", balance: `${whole}.${frac}` }] });
}

function initialTxidCheck(world: MockWorld): TxidCheck {
  const t = world.deposit?.newDeviceTxid;
  if (!t) return { kind: "idle" };
  return t.paysLock ? { kind: "found", sats: world.deposit?.amountSats ?? 5_000_000n } : { kind: "no_output" };
}

/** The journey as a harness scenario describes it. Actions that would reach a wallet or the network do nothing. */
export function useMockJourney(world: MockWorld): JourneyModel {
  const d = world.deposit ?? {};
  const { stellar: sw, bitcoin: bw, connect } = world.wallets;
  const amountSats = d.amountSats ?? 5_000_000n;
  const amount = formatBtc(amountSats);
  const parsed = parseBtcAmount(amount);

  const ui = useJourneyUi({
    amount,
    amountError: d.amountError && !parsed.ok ? parsed.error : null,
    amountConfirmed: d.amountConfirmed ?? (!d.amountError && Boolean(sw || connect)),
    ack: d.reviewAcknowledged,
    newDeviceOpen: Boolean(d.newDeviceTxid),
    txid: d.newDeviceTxid?.txid,
    txidCheck: initialTxidCheck(world),
  });

  const [openedAt] = useState(() => Date.now());
  const flow = world.flow?.state ?? IDLE;
  const depositPos = world.positions.find((p) => p.local.pendingDeposit);
  const pending = depositPos?.local.pendingDeposit ?? null;
  const status = usePositionStatus(depositPos?.local ?? null);

  const alreadyRegistered = Boolean(depositPos?.chain.commitmentForTxid && depositPos.chain.commitmentPending === false);
  const done = Boolean(d.done) || alreadyRegistered;
  const loan = world.positions.find((p) => p.local.position)?.local.position;
  const loanSats = loan?.collateralSats;
  const doneSats = loanSats ? BigInt(loanSats) : pending ? BigInt(pending.sats) : null;

  const wrongNetwork = sw?.network === "PUBLIC" ? "Stellar mainnet" : null;
  const funding = sw ? mockFunding(sw.xlmStroops) : null;
  const loans = sw ? (sw.loans === "unsigned" ? "unsigned" : sw.loans) : "unsigned";
  const lowAck = ui.lowAck;
  const fundingOk = funding !== null && (funding.kind === "ok" || (funding.kind === "low" && lowAck));
  const stellarReady = Boolean(sw) && !wrongNetwork && fundingOk && loans === "found";

  const btcWrongNetwork = bw && bw.network !== config.bitcoin.network ? bw.network : null;
  const sats = pending ? BigInt(pending.sats) : confirmedSats(ui);
  const bitcoinReady = Boolean(bw) && !btcWrongNetwork && sats !== null && (bw?.balanceSats ?? 0n) >= sats;

  const sending = !pending && (flow.phase === "awaiting_signature" || flow.phase === "preparing") && !done;
  const stage = pending && !done ? depositStage(pending, status.status.kind, flow) : null;
  const r = route(ui, { done, stage, sending, stellarReady, bitcoinReady });

  const tip = world.chain.btcTipHeight ?? null;
  const timelock = pending?.timelockHeight ?? TIMELOCK;
  const blocksLeft = tip !== null ? timelock - tip : null;
  const now = pending?.createdAt ?? openedAt;

  return {
    ...r,
    unavailable: Boolean(d.unavailable),
    busy: sending,
    amount: {
      value: ui.amount,
      error: ui.amountError,
      balanceSats: bw?.balanceSats ?? null,
      set: ui.setAmount,
      submit: ui.submitAmount,
    },
    sats,
    priceStroops: world.chain.oraclePriceStroops ?? null,
    stellar: {
      address: sw?.address ?? null,
      walletName: "Freighter",
      connecting: connect?.wallet === "stellar" && connect.state === "awaiting",
      connectError:
        connect?.wallet === "stellar" && connect.state === "rejected" ? { declined: true, raw: "User declined access" } : null,
      wrongNetwork,
      funding: funding ? { kind: "ok", value: funding } : { kind: "checking" },
      fundBusy: false,
      fundError: null,
      lowAck,
      loans,
      loansCount: world.positions.filter((p) => p.local.position).length,
      loansError: null,
      signError: null,
      ready: stellarReady,
      connect: noop,
      useOther: noop,
      sign: noop,
      retryFind: noop,
      fund: noop,
      recheckFunding: noop,
      ackLow: () => ui.setLowAck(true),
    },
    bitcoin: {
      address: btcWrongNetwork ? null : (bw?.address ?? null),
      connecting: connect?.wallet === "bitcoin" && connect.state === "awaiting",
      error: btcWrongNetwork
        ? { kind: "network", message: `Switch your Bitcoin wallet to Bitcoin ${config.bitcoin.network} (currently ${btcWrongNetwork}).` }
        : connect?.wallet === "bitcoin" && connect.state === "rejected"
          ? { kind: "declined" }
          : null,
      balance: bw && !btcWrongNetwork ? { kind: "ok", value: bw.balanceSats } : null,
      ready: bitcoinReady,
      connect: noop,
      useOther: noop,
      recheck: noop,
    },
    review: {
      lockAddress: pending?.p2wsh ?? (bw ? LOCK_ADDRESS : null),
      timelockHeight: timelock,
      exitDate: blocksLeft !== null ? exitDate(blocksLeft, now) : null,
      feeSats: estimateFeeSats(2),
      tooClose: Boolean(d.timelockTooClose) || (blocksLeft !== null && blocksLeft < TIMELOCK_MIN_BLOCKS_LEFT),
      ack: ui.ack,
      slideKey: ui.slideKey,
      setAck: ui.setAck,
      send: noop,
    },
    newDevice: {
      open: ui.newDeviceOpen,
      txid: ui.txid,
      check: ui.txidCheck,
      setOpen: ui.setNewDeviceOpen,
      setTxid: ui.setTxid,
      submit: noop,
      confirm: noop,
    },
    deposit: {
      pending,
      status,
      flow,
      m: depositPos?.relayer?.minConfirmations ?? config.bitcoin.minConfirmations,
      relayerUnreachable: Boolean(world.globals.relayerUnreachable),
      drivenElsewhere: false,
      otherTx: Boolean(world.globals.otherTabTx),
      foundOnLoad: Boolean(pending) && !world.flow,
      secondBlocked: Boolean(d.secondBlocked),
      unlocked: sw?.loans === "found",
      recheck: noop,
      register: noop,
      finish: noop,
    },
    done: { sats: doneSats, index: loan?.index ?? pending?.positionIndex ?? null, reset: ui.reset },
  };
}
