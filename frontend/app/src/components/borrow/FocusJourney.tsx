"use client";

import { useEffect, useRef, useState } from "react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { GITHUB_ISSUES_URL } from "@/lib/links";
import {
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
import { AmountStep, BitcoinStep, DoneStep, RegisterStep, ReviewStep, StellarStep, WaitStep, confirmationCount, registerQuestion } from "./steps";

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
      <div className="fo-col">
        <section className="fo-card">
          <div className="wz-stack">
            <h1 className="fo-q">Deposits are unavailable on this deployment.</h1>
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
      <div className="fo-col">
        <section className="fo-card wz-rise">
          <DoneStep m={model} heading={heading} />
        </section>
      </div>
    );
  }

  const current = stepIndex(step);
  const label = STEPS[current].label;
  const back = !model.busy ? model.back : null;
  const wait = step === "wait" ? confirmationCount(model) : null;

  return (
    <div className="fo-col">
      <div className="fo-progress" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s.id} data-state={i < current ? "done" : i === current ? "now" : "next"} />
        ))}
      </div>
      <div className="fo-meta">
        <span>
          <b className="fo-step-n">
            Step {current + 1} of {STEPS.length}
          </b>
          {label}
        </span>
        {back && (
          <button type="button" className="wz-btn wz-btn-text" onClick={() => model.edit(back)}>
            Back
          </button>
        )}
      </div>
      <p className="wz-sr" role="status">
        Step {current + 1} of {STEPS.length}: {label}
      </p>

      <section className="fo-card wz-enter" key={step}>
        {step !== "amount" && <Summary m={model} />}
        <h1 className="fo-q" ref={heading} tabIndex={-1}>
          {step === "register" ? registerQuestion(model) : QUESTION[step]}
        </h1>
        {wait && (
          <p className="fo-big mono" aria-hidden="true">
            {wait.n}
            <span>/{wait.m}</span>
          </p>
        )}
        <div className="fo-body">
          {step === "amount" && <AmountStep m={model} />}
          {step === "stellar" && <StellarStep m={model} />}
          {step === "bitcoin" && <BitcoinStep m={model} />}
          {step === "review" && <ReviewStep m={model} />}
          {step === "wait" && <WaitStep m={model} />}
          {step === "register" && <RegisterStep m={model} />}
        </div>
      </section>

      {step === "amount" && (
        <ul className="fo-need" aria-label="What you'll need">
          <li>
            <b>A Stellar wallet</b> to receive USDC and sign loan actions
          </li>
          <li>
            <b>Xverse with {config.target === "mainnet" ? "BTC" : "test BTC"}</b> to send the BTC you lock, on{" "}
            {BTC_NETWORK_LABEL}
          </li>
          <li>
            <b>About {journeyMinutes(config.bitcoin.minConfirmations)} minutes</b>, mostly waiting for Bitcoin. You
            can leave and come back.
          </li>
        </ul>
      )}
    </div>
  );
}

function Summary({ m }: { m: JourneyModel }) {
  const [open, setOpen] = useState(false);
  const values = summaryValues(m.sats, m.priceStroops);
  if (!values.locking) return null;
  const editAmount = m.canEdit("amount");

  const row = (label: string, value: React.ReactNode, edit?: EditableStep) => (
    <div className="wz-row">
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
    <div className="fo-summary">
      <div className="fo-summary-bar">
        <span className="fo-sum-vals">
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
        <span className="fo-sum-ctl">
          {editAmount && (
            <button type="button" className="wz-btn wz-btn-text" aria-label={EDIT_LABEL.amount} onClick={() => m.edit("amount")}>
              Edit
            </button>
          )}
          <button
            type="button"
            className="fo-toggle"
            aria-expanded={open}
            aria-controls="fo-summary-body"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="wz-sr">Loan details</span>
            <span aria-hidden="true" className="fo-caret" data-open={open} />
          </button>
        </span>
      </div>
      {open && (
        <dl className="fo-summary-body" id="fo-summary-body">
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
