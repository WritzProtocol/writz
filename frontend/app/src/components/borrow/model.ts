"use client";

import { useCallback, useState } from "react";
import type { FlowState } from "@/lib/flow/engine";
import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { DerivedStatus } from "@/lib/status/types";
import {
  backTarget,
  canEdit,
  parseBtcAmount,
  routeStep,
  type EditableStep,
  type Funding,
  type JourneyStep,
  type RouteFacts,
} from "@/lib/borrow/journey";

export type Reading<T> = { kind: "checking" } | { kind: "failed" } | { kind: "ok"; value: T };

export interface StellarModel {
  address: string | null;
  walletName: string;
  connecting: boolean;
  connectError: { declined: boolean; raw: string } | null;
  wrongNetwork: string | null;
  funding: Reading<Funding>;
  fundBusy: boolean;
  fundError: unknown;
  lowAck: boolean;
  loans: "unsigned" | "signing" | "finding" | "found" | "failed";
  loansCount: number;
  loansError: unknown;
  signError: unknown;
  ready: boolean;
  connect(): void;
  useOther(): void;
  sign(): void;
  retryFind(): void;
  fund(): void;
  recheckFunding(): void;
  ackLow(): void;
}

export type BitcoinError = { kind: "declined" } | { kind: "network"; message: string } | { kind: "other"; raw: string };

export interface BitcoinModel {
  address: string | null;
  connecting: boolean;
  error: BitcoinError | null;
  balance: Reading<bigint> | null;
  ready: boolean;
  connect(): void;
  useOther(): void;
  recheck(): void;
}

export interface ReviewModel {
  lockAddress: string | null;
  timelockHeight: number;
  exitDate: string | null;
  feeSats: number | null;
  tooClose: boolean;
  ack: boolean;
  slideKey: number;
  setAck(v: boolean): void;
  send(): void;
}

export type TxidCheck =
  | { kind: "idle" }
  | { kind: "invalid" }
  | { kind: "checking" }
  | { kind: "found"; sats: bigint }
  | { kind: "no_output" }
  | { kind: "saving" }
  | { kind: "error"; error: unknown };

export interface NewDeviceModel {
  open: boolean;
  txid: string;
  check: TxidCheck;
  setOpen(v: boolean): void;
  setTxid(v: string): void;
  submit(): void;
  confirm(): void;
}

export interface DepositModel {
  pending: PendingDeposit | null;
  status: DerivedStatus;
  flow: FlowState;
  m: number;
  relayerUnreachable: boolean;
  drivenElsewhere: boolean;
  otherTx: boolean;
  foundOnLoad: boolean;
  secondBlocked: boolean;
  unlocked: boolean;
  recheck(): void;
  register(): void;
  finish(): void;
}

export interface JourneyModel {
  step: JourneyStep;
  unavailable: boolean;
  amount: { value: string; error: string | null; balanceSats: bigint | null; set(v: string): void; submit(): void };
  /** The amount being locked: the confirmed input, or the deposit's own once BTC is sent. */
  sats: bigint | null;
  priceStroops: bigint | null;
  stellar: StellarModel;
  bitcoin: BitcoinModel;
  review: ReviewModel;
  newDevice: NewDeviceModel;
  deposit: DepositModel;
  /** `index` is the new loan's local position index, once known. */
  done: { sats: bigint | null; index: number | null; reset(): void };
  busy: boolean;
  back: EditableStep | null;
  canEdit(step: EditableStep): boolean;
  edit(step: EditableStep): void;
  finishEdit(): void;
}

export interface JourneyUi {
  amount: string;
  amountError: string | null;
  amountConfirmed: boolean;
  editing: EditableStep | null;
  lowAck: boolean;
  ack: boolean;
  slideKey: number;
  newDeviceOpen: boolean;
  txid: string;
  txidCheck: TxidCheck;
  setAmount(v: string): void;
  submitAmount(): void;
  setEditing(s: EditableStep | null): void;
  setLowAck(v: boolean): void;
  setAck(v: boolean): void;
  bumpSlide(): void;
  setNewDeviceOpen(v: boolean): void;
  setTxid(v: string): void;
  setTxidCheck(c: TxidCheck): void;
  reset(): void;
}

export interface UiInit {
  amount?: string;
  amountError?: string | null;
  amountConfirmed?: boolean;
  ack?: boolean;
  newDeviceOpen?: boolean;
  txid?: string;
  txidCheck?: TxidCheck;
}

/** Screen-local state shared by the live journey and the mock harness. */
export function useJourneyUi(init: UiInit = {}): JourneyUi {
  const [amount, setAmountRaw] = useState(init.amount ?? "");
  const [amountError, setAmountError] = useState<string | null>(init.amountError ?? null);
  const [amountConfirmed, setAmountConfirmed] = useState(init.amountConfirmed ?? false);
  const [editing, setEditing] = useState<EditableStep | null>(null);
  const [lowAck, setLowAck] = useState(false);
  const [ack, setAck] = useState(init.ack ?? false);
  const [slideKey, setSlideKey] = useState(0);
  const [newDeviceOpen, setNewDeviceOpen] = useState(init.newDeviceOpen ?? false);
  const [txid, setTxidRaw] = useState(init.txid ?? "");
  const [txidCheck, setTxidCheck] = useState<TxidCheck>(init.txidCheck ?? { kind: "idle" });

  const setAmount = useCallback(
    (v: string) => {
      setAmountRaw(v);
      if (amountError) {
        const r = parseBtcAmount(v);
        setAmountError(r.ok ? null : r.error);
      }
    },
    [amountError],
  );

  const submitAmount = useCallback(() => {
    const r = parseBtcAmount(amount);
    if (!r.ok) {
      setAmountError(r.error);
      return;
    }
    setAmountError(null);
    setAmountConfirmed(true);
    setEditing(null);
  }, [amount]);

  return {
    amount,
    amountError,
    amountConfirmed,
    editing,
    lowAck,
    ack,
    slideKey,
    newDeviceOpen,
    txid,
    txidCheck,
    setAmount,
    submitAmount,
    setEditing,
    setLowAck,
    setAck,
    bumpSlide: () => setSlideKey((k) => k + 1),
    setNewDeviceOpen,
    setTxid: (v) => {
      setTxidRaw(v);
      setTxidCheck({ kind: "idle" });
    },
    setTxidCheck,
    reset() {
      setAmountRaw("");
      setAmountError(null);
      setAmountConfirmed(false);
      setEditing(null);
      setAck(false);
      setSlideKey((k) => k + 1);
      setNewDeviceOpen(false);
      setTxidRaw("");
      setTxidCheck({ kind: "idle" });
    },
  };
}

export const confirmedSats = (ui: JourneyUi): bigint | null => {
  if (!ui.amountConfirmed) return null;
  const r = parseBtcAmount(ui.amount);
  return r.ok ? r.sats : null;
};

/** Applies the routing and edit rules to the facts both journeys collect. */
export function route(ui: JourneyUi, f: Omit<RouteFacts, "amountConfirmed" | "editing">) {
  const facts: RouteFacts = { ...f, amountConfirmed: ui.amountConfirmed, editing: ui.editing };
  const step = routeStep(facts);
  return {
    step,
    back: backTarget(step, facts),
    canEdit: (target: EditableStep) => canEdit(target, step, facts),
    edit: (target: EditableStep) => {
      if (canEdit(target, step, facts)) ui.setEditing(target);
    },
    finishEdit: () => ui.setEditing(null),
  };
}
