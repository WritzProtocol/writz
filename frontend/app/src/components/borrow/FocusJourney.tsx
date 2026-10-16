"use client";

import { useEffect, useRef, useState } from "react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { GITHUB_ISSUES_URL } from "@/lib/links";
import {
  formatBtc,
  journeyMinutes,
  shortAddress,
  STEPS,
  stepIndex,
  summaryValues,
  type EditableStep,
  type JourneyStep,
} from "@/lib/borrow/journey";
import { ExternalLink } from "@/components/redesign/ui";
import type { JourneyModel } from "./model";
import { AmountStep, BitcoinStep, DoneStep, RegisterStep, ReviewStep, StellarStep, WaitStep, registerQuestion } from "./steps";

const QUESTION: Record<Exclude<JourneyStep, "done" | "register">, string> = {
  amount: "How much BTC do you want to lock?",
  stellar: "Connect the wallet that receives your USDC",
  bitcoin: "Connect the wallet that holds your BTC",
  review: "Check everything, then send",
  wait: "Bitcoin is confirming your deposit",
};

const EDIT_LABEL: Record<EditableStep, string> = {
  amount: "Edit amount",
  stellar: "Edit Stellar wallet",
  bitcoin: "Edit Bitcoin wallet",
};

/** One question per screen: segmented progress, a collapsed loan summary and the current step's card. */
export function FocusJourney({ m: model }: { m: JourneyModel }) {
  const { step } = model;
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  if (model.unavailable && !model.deposit.pending) {
    return (
      <div className="bj">
        <section className="bj-end">
          <div className="wz-stack">
            <h1 className="bj-q">Deposits are unavailable on this deployment.</h1>
            <p>This app isn&apos;t set up for deposits right now. Nothing was sent.</p>
            <p>
              <ExternalLink href={GITHUB_ISSUES_URL}>Report a problem on GitHub</ExternalLink>
            </p>
          </div>
        </section>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="bj">
        <section className="bj-end wz-cut wz-rise">
          <DoneStep m={model} heading={heading} />
        </section>
      </div>
    );
  }

  const current = stepIndex(step);
  const label = STEPS[current].label;
  const back = !model.busy ? model.back : null;
  const lock = step === "review" && !model.review.tooClose && model.review.lockAddress && model.sats !== null;
  const aside = step === "amount" || Boolean(lock);

  return (
    <div className="bj">
      <div className="bj-progress" aria-hidden="true" style={{ ["--bj-steps" as string]: STEPS.length }}>
        {STEPS.map((s, i) => (
          <i key={s.id} data-state={i < current ? "done" : i === current ? "now" : "next"} />
        ))}
      </div>
      <div className="bj-stepline">
        <p>
          <b>
            Step {current + 1} of {STEPS.length}
          </b>
          {label}
        </p>
        {back && (
          <button type="button" className="wz-btn wz-btn-text" onClick={() => model.edit(back)}>
            Back
          </button>
        )}
      </div>
      <p className="wz-sr" role="status">
        Step {current + 1} of {STEPS.length}: {label}
      </p>

      <div className="wz-enter" key={step}>
        {step !== "amount" && <Summary m={model} />}
        <h1 className="bj-q" ref={heading} tabIndex={-1}>
          {step === "register" ? registerQuestion(model) : QUESTION[step]}
        </h1>
        <div className="bj-grid" data-aside={aside}>
          <div className="bj-col">
            {step === "amount" && <AmountStep m={model} />}
            {step === "stellar" && <StellarStep m={model} />}
            {step === "bitcoin" && <BitcoinStep m={model} />}
            {step === "review" && <ReviewStep m={model} />}
            {step === "wait" && <WaitStep m={model} />}
            {step === "register" && <RegisterStep m={model} />}
          </div>
          {step === "amount" && (
            <aside className="bj-aside bj-need" aria-labelledby="bj-need">
              <h2 id="bj-need">What you&apos;ll need</h2>
              <ul className="bj-ticks">
                <li>
                  <i aria-hidden="true" />
                  <b>A Stellar wallet</b>
                  <span>To receive USDC and sign loan actions</span>
                </li>
                <li>
                  <i aria-hidden="true" />
                  <b>Xverse with {config.target === "mainnet" ? "BTC" : "test BTC"}</b>
                  <span>To send the BTC you lock, on {BTC_NETWORK_LABEL}</span>
                </li>
                <li>
                  <i aria-hidden="true" />
                  <b>About {journeyMinutes(config.bitcoin.minConfirmations)} minutes</b>
                  <span>Mostly waiting for Bitcoin. You can leave and come back.</span>
                </li>
              </ul>
            </aside>
          )}
          {lock && <LockAside m={model} />}
        </div>
      </div>
    </div>
  );
}

/** The gold slab beside the review: what the lock does now and after the timelock. */
function LockAside({ m }: { m: JourneyModel }) {
  const r = m.review;
  const height = r.timelockHeight?.toLocaleString("en-US");
  return (
    <aside className="bj-aside bj-slab" aria-labelledby="bj-lock">
      <h2 id="bj-lock">Your lock on Bitcoin</h2>
      <p>A Bitcoin Script holds it, not a company.</p>
      <div className="bj-frag">
        <span>You lock</span>
        <p className="mono">{formatBtc(m.sats ?? 0n)} BTC</p>
        <ul className="bj-ticks">
          <li>
            <i aria-hidden="true" />
            <b>Now</b>
            <span>Only your key and Writz&apos;s together can move BTC from this address.</span>
          </li>
          <li>
            <i aria-hidden="true" />
            <b>
              After block <span className="mono">{height ?? "..."}</span>
            </b>
            <span>Your key alone can.{r.exitDate ? ` That is about ${r.exitDate}.` : ""}</span>
          </li>
        </ul>
      </div>
    </aside>
  );
}

function Summary({ m }: { m: JourneyModel }) {
  const [open, setOpen] = useState(false);
  const values = summaryValues(m.sats, m.priceStroops);
  if (!values.locking) return null;
  const editAmount = m.canEdit("amount");

  const row = (label: string, value: React.ReactNode, edit?: EditableStep) => (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {edit && m.canEdit(edit) && (
          <button type="button" className="wz-btn wz-btn-text" aria-label={EDIT_LABEL[edit]} onClick={() => m.edit(edit)}>
            Edit
          </button>
        )}
      </dd>
    </div>
  );

  return (
    <div className="bj-sum">
      <div className="bj-sum-bar">
        <span className="bj-sum-vals">
          <span>
            <small>Locking</small>
            <span className="mono">{values.locking}</span>
          </span>
          {values.borrowUpTo && (
            <span>
              <small>Borrow up to</small>
              <span className="mono">{values.borrowUpTo}</span>
            </span>
          )}
        </span>
        <span className="bj-sum-ctl">
          {editAmount && (
            <button type="button" className="wz-btn wz-btn-sm" aria-label={EDIT_LABEL.amount} onClick={() => m.edit("amount")}>
              Edit
            </button>
          )}
          <button
            type="button"
            className="bj-toggle"
            aria-expanded={open}
            aria-controls="bj-sum-body"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="wz-sr">Loan details</span>
            <span aria-hidden="true" className="bj-caret" data-open={open} />
          </button>
        </span>
      </div>
      {open && (
        <dl className="bj-sum-body" id="bj-sum-body">
          {m.stellar.address && row("Stellar wallet", <span className="mono">{shortAddress(m.stellar.address)}</span>, "stellar")}
          {m.bitcoin.address && row("Bitcoin wallet", <span className="mono">{shortAddress(m.bitcoin.address, 6, 6)}</span>, "bitcoin")}
          {row(
            "Lock address",
            m.review.lockAddress ? <span className="mono">{shortAddress(m.review.lockAddress, 8, 6)}</span> : "After you connect Xverse",
          )}
          {row("Your way out", m.review.exitDate ? `Reclaim alone after about ${m.review.exitDate}` : "Checking…")}
        </dl>
      )}
    </div>
  );
}
