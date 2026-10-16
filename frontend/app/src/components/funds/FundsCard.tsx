"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { ErrorFlow } from "@/lib/errors";
import { isInFlight, type FlowState } from "@/lib/flow/engine";
import { checkAmount, type FundsSide } from "@/lib/funds/model";
import { toFieldValue, type Read } from "@/lib/loan/model";
import { ErrorBox, Notice, Spinner } from "@/components/ui";
import { AmountField, TxResult, TxRunning } from "@/components/loan/parts";

export interface SideModel {
  label: string;
  fieldLabel: string;
  /** The most this side can move; null while unknown. */
  max: bigint | null;
  hint: ReactNode;
  over(max: bigint): string;
  /** Why this side can't be used right now. */
  blocked: string | null;
  done(amount: bigint): string;
  errorFlow: ErrorFlow;
  /** Starting field value; the harness uses it to show a field error. */
  initial?: string;
}

export interface FundsModel {
  unit: string;
  walletName: string;
  sides: Record<FundsSide, SideModel>;
  defaultSide: FundsSide;
  trustline: Read<boolean>;
  trust: { text: string; button: string; busy: boolean; error: unknown; add(): void };
  flow: FlowState;
  action: FundsSide | null;
  lastAmount: bigint | null;
  otherTx: boolean;
  submit(side: FundsSide, stroops: bigint): void;
  dismiss(): void;
  checkAgain(): void;
}

const SIDES: readonly FundsSide[] = ["in", "out"];
const WAITING = "Waiting for your transaction.";

function SidePanel({ m, side }: { m: FundsModel; side: FundsSide }) {
  const checking = m.trustline.kind === "checking" ? "Checking your wallet..." : null;
  const s = { ...m.sides[side], blocked: checking ?? m.sides[side].blocked };
  const [value, setValue] = useState(s.initial ?? "");
  const [touched, setTouched] = useState(Boolean(s.initial));
  const mine = m.action === side;
  const running = mine && isInFlight(m.flow);
  const check = checkAmount(value, s.max, s.over);
  const error = touched && value !== "" && !check.ok ? check.error : null;
  const id = `funds-${side}`;

  if (running) return <TxRunning flow={m.flow} walletName={m.walletName} />;

  return (
    <div className="wz-stack">
      {mine ? (
        <TxResult
          flow={m.flow}
          success={m.lastAmount !== null ? s.done(m.lastAmount) : "Done."}
          walletName={m.walletName}
          context={s.errorFlow}
          onDismiss={m.dismiss}
          onCheckAgain={m.checkAgain}
        />
      ) : null}
      <AmountField
        id={id}
        label={s.fieldLabel}
        unit={m.unit}
        value={value}
        onChange={(v) => {
          setValue(v);
          setTouched(true);
        }}
        maxLabel="Max"
        onMax={() => {
          if (s.max !== null) {
            setValue(toFieldValue(s.max));
            setTouched(true);
          }
        }}
        error={error}
        hint={s.hint}
        disabled={Boolean(s.blocked)}
      />
      <div className="wz-actions">
        <button
          type="button"
          className="wz-btn wz-btn-gold"
          aria-disabled={Boolean(s.blocked) || m.otherTx || !check.ok}
          aria-describedby={s.blocked || m.otherTx ? `${id}-why` : undefined}
          onClick={() => {
            setTouched(true);
            if (s.blocked || m.otherTx || !check.ok) return;
            m.submit(side, check.stroops);
            setValue("");
            setTouched(false);
          }}
        >
          {s.label}
        </button>
      </div>
      {s.blocked || m.otherTx ? (
        <p id={`${id}-why`} className="wz-hint">
          {s.blocked ?? "Waiting for your other transaction."}
        </p>
      ) : null}
    </div>
  );
}

/** One card with two segments, one open at a time, the reason shown for a disabled one. */
export function FundsCard({ m, label }: { m: FundsModel; label: string }) {
  const busy = m.action !== null && isInFlight(m.flow);
  const [picked, setPicked] = useState<FundsSide | null>(null);
  const tab = busy && m.action ? m.action : (picked ?? m.defaultSide);
  const disabledOf = (t: FundsSide) => (busy && m.action !== t ? WAITING : null);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? "in" : e.key === "End" ? "out" : tab === "in" ? "out" : "in";
    if (!disabledOf(next)) {
      setPicked(next);
      document.getElementById(`funds-tab-${next}`)?.focus();
    }
  };

  if (m.trustline.kind === "ok" && !m.trustline.value) {
    return (
      <section className="fu-panel wz-stack" aria-label={label}>
        <p className="wz-strong">{m.trust.text}</p>
        <div className="wz-actions">
          <button type="button" className="wz-btn wz-btn-gold" disabled={m.trust.busy || m.otherTx} onClick={m.trust.add}>
            {m.trust.busy ? (
              <>
                <Spinner /> Confirm in {m.walletName}
              </>
            ) : (
              m.trust.button
            )}
          </button>
        </div>
        {m.trust.error ? <ErrorBox error={m.trust.error} label="Not added" /> : null}
      </section>
    );
  }

  return (
    <section className="wz-stack" aria-label={label}>
      <div className="wz-seg fu-seg" role="tablist" aria-label={label}>
        {SIDES.map((t) => {
          const reason = disabledOf(t);
          return (
            <button
              key={t}
              id={`funds-tab-${t}`}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls="funds-panel"
              aria-disabled={Boolean(reason)}
              tabIndex={tab === t ? 0 : -1}
              title={reason ?? undefined}
              onClick={() => !reason && setPicked(t)}
              onKeyDown={onKey}
            >
              {m.sides[t].label}
            </button>
          );
        })}
      </div>
      {busy ? <p className="wz-hint">{WAITING}</p> : null}
      <div className="fu-panel wz-enter" id="funds-panel" role="tabpanel" aria-labelledby={`funds-tab-${tab}`} key={tab}>
        <SidePanel m={m} side={tab} />
      </div>
    </section>
  );
}

export function NotConnected({ text, connect, connecting }: { text: string; connect: () => void; connecting: boolean }) {
  return (
    <Notice
      tone="neutral"
      actions={
        <button type="button" className="wz-btn wz-btn-gold" disabled={connecting} onClick={connect}>
          {connecting ? "Confirm in your wallet" : "Connect Stellar wallet"}
        </button>
      }
    >
      <p>{text}</p>
    </Notice>
  );
}
