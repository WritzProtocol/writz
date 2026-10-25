"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { config } from "@/config";
import { formatUsdc } from "@/lib/borrow/journey";
import { baseSepoliaTxUrl, stellarTxUrl } from "@/lib/explorer";
import { isInFlight } from "@/lib/flow/engine";
import {
  cctpSettled,
  cctpSteps,
  formatBp,
  parseEvmAddress,
  receiveOptions,
  stepperView,
  type BorrowStep,
  type CctpStatus,
  type ReceiveChoice,
  type ReceiveOption,
  type SecondStep,
  type SwapQuote,
} from "@/lib/receive";
import { logReceived } from "@/lib/receive/clientTimeline";
import type { ReceiveSeed } from "@/lib/mock/types";
import type { Position } from "@/lib/position/types";
import { shortAddress } from "@/lib/borrow/journey";
import { ErrorBox, ExternalLink, Notice, Spinner } from "@/components/ui";
import type { LoanModel } from "./model";

type Leg = { option: "xlm" | "base"; amount: bigint; to: `0x${string}` | null };

const FIXTURE_BURN = "cc".repeat(32);
const POLL_MS = 5_000;

function seededSecond(seed: ReceiveSeed | undefined): SecondStep<SwapQuote> {
  switch (seed?.step2) {
    case "failed":
      return { kind: "failed", error: new Error("The swap returned less than the minimum, so nothing was swapped.") };
    case "skipped":
      return { kind: "skipped" };
    case "done":
    case "sent":
      return { kind: "done", hash: seed.option === "base" ? FIXTURE_BURN : "5a".repeat(32) };
    default:
      return { kind: "idle" };
  }
}

/** What the borrow panel needs to offer receive-as: the options, the choice, and step 2 once step 1 settled. */
export function useReceive(m: LoanModel, position: Position | null) {
  const seed = m.receiveSeed;
  const options = receiveOptions({ swap: Boolean(m.receive.swap), cctp: Boolean(m.receive.cctp), eurc: config.receive.eurc });
  const [option, setOption] = useState<ReceiveOption>(seed?.option ?? "usdc");
  const [to, setTo] = useState(seed?.to ?? "");
  const [toTouched, setToTouched] = useState(false);
  const [leg, setLeg] = useState<Leg | null>(() =>
    seed?.step2 && (seed.option === "xlm" || seed.option === "base")
      ? { option: seed.option, amount: seed.amountStroops, to: seed.to ? (seed.to as `0x${string}`) : null }
      : null,
  );
  const [second, setSecond] = useState<SecondStep<SwapQuote>>(() => seededSecond(seed));
  const [priceMoved, setPriceMoved] = useState(false);
  const [cctp, setCctp] = useState<CctpStatus | null>(null);

  const parsedTo = parseEvmAddress(to);
  const toError = option === "base" && (toTouched || to) && !parsedTo.ok ? parsedTo.error : null;

  let borrow: BorrowStep = "todo";
  if (leg) {
    if (seed?.step2) borrow = "done";
    else if (m.action === "borrow") {
      if (isInFlight(m.flow)) borrow = "running";
      else if (m.flow.phase === "settled") borrow = "done";
      else if (m.flow.phase === "failed" || m.flow.phase === "signature_cancelled" || m.flow.phase === "timed_out") borrow = "failed";
      else borrow = "running";
    }
  }
  const view = stepperView(borrow, second);
  const burnHash = leg?.option === "base" && second.kind === "done" ? second.hash : null;

  const quote = useCallback(async () => {
    if (!m.receive.swap || !leg) return;
    setPriceMoved(false);
    setSecond({ kind: "quoting" });
    try {
      setSecond({ kind: "quoted", quote: await m.receive.swap.quote(leg.amount) });
    } catch (error) {
      setSecond({ kind: "failed", error });
    }
  }, [m.receive.swap, leg]);

  // Step 2 of the XLM path opens with a quote as soon as the borrow settles.
  useEffect(() => {
    if (leg?.option !== "xlm" || borrow !== "done" || second.kind !== "idle") return;
    const t = setTimeout(() => void quote(), 0);
    return () => clearTimeout(t);
  }, [leg, borrow, second.kind, quote]);

  const swap = useCallback(async () => {
    const api = m.receive.swap;
    if (!api || !leg || !m.owner || second.kind !== "quoted") return;
    const shown = second.quote;
    setSecond({ kind: "signing" });
    try {
      // Quote again just before signing; if the minimum got worse, show it instead of signing it.
      const fresh = await api.quote(leg.amount);
      if (fresh.minOutStroops < shown.minOutStroops) {
        setPriceMoved(true);
        setSecond({ kind: "quoted", quote: fresh });
        return;
      }
      const { hash } = await api.execute(fresh, m.owner);
      setSecond({ kind: "done", hash });
      if (position) logReceived(m.owner, position.id, { kind: "received", chain: "stellar", hash, at: Date.now(), detail: "as XLM" });
    } catch (error) {
      setSecond({ kind: "failed", error });
    }
  }, [m.receive.swap, m.owner, leg, second, position]);

  const send = useCallback(async () => {
    const api = m.receive.cctp;
    if (!api || !leg?.to || !m.owner) return;
    setSecond({ kind: "signing" });
    try {
      const { burnHash } = await api.send(leg.amount, leg.to, m.owner);
      setSecond({ kind: "done", hash: burnHash });
    } catch (error) {
      setSecond({ kind: "failed", error });
    }
  }, [m.receive.cctp, m.owner, leg]);

  // Follow the transfer until it arrives or fails.
  useEffect(() => {
    const api = m.receive.cctp;
    if (!api || !burnHash || cctpSettled(cctp)) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await api.status(burnHash);
        if (!live) return;
        setCctp(s);
        if (s.kind === "arrived" && m.owner && position) {
          logReceived(m.owner, position.id, { kind: "received", chain: "base-sepolia", hash: s.mintHash, at: Date.now(), detail: "on Base Sepolia" });
        }
      } catch {
        // A failed read is retried on the next tick; the transfer itself is unaffected.
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [m.receive.cctp, m.owner, burnHash, cctp, position]);

  return {
    options,
    option,
    setOption: (o: ReceiveOption) => {
      setOption(o);
      setToTouched(false);
    },
    to,
    setTo,
    toError,
    touchTo: () => setToTouched(true),
    /** Whether the panel can start: the destination is valid when one is needed. */
    ready: option !== "base" || parsedTo.ok,
    leg,
    second,
    view,
    priceMoved,
    cctp,
    burnHash,
    /** Called with the borrow: remembers what step 2 does with it. */
    start(amount: bigint) {
      if (option === "xlm") setLeg({ option, amount, to: null });
      else if (option === "base" && parsedTo.ok) setLeg({ option, amount, to: parsedTo.address });
      else setLeg(null);
      setSecond({ kind: "idle" });
      setCctp(null);
      setPriceMoved(false);
    },
    quote,
    swap,
    send,
    skip: () => setSecond({ kind: "skipped" }),
    reset: () => {
      setLeg(null);
      setSecond({ kind: "idle" });
      setCctp(null);
    },
  };
}

export type Receive = ReturnType<typeof useReceive>;

// ── Choice ───────────────────────────────────────────────────────────────

export function ReceiveSelector({ r, disabled }: { r: Receive; disabled: boolean }) {
  const id = useId();
  if (r.options.length < 2) return null;
  return (
    <div className="wz-stack" style={{ gap: 8 }}>
      <p className="wz-label" id={`${id}-label`}>
        Receive as
      </p>
      <div className="wz-chips ln-recv" role="group" aria-labelledby={`${id}-label`}>
        {r.options.map((o: ReceiveChoice) => (
          <button
            key={o.id}
            type="button"
            className="wz-chip ln-recv-opt"
            aria-pressed={r.option === o.id}
            disabled={disabled || o.id === "eurc"}
            onClick={() => r.setOption(o.id)}
          >
            <span>{o.label}</span>
            <small>{o.id === "eurc" ? "No testnet liquidity yet" : o.network}</small>
          </button>
        ))}
      </div>
      {r.option === "xlm" && (
        <p className="wz-hint">Your debt stays in USDC; if the price of XLM moves, what you owe in XLM terms changes.</p>
      )}
      {r.option === "base" && (
        <p className="wz-hint">Your debt stays in USDC on Stellar. The USDC is sent to Base Sepolia for you, so you need no wallet there.</p>
      )}
    </div>
  );
}

export function BaseAddressField({ r, disabled }: { r: Receive; disabled: boolean }) {
  const id = useId();
  if (r.option !== "base") return null;
  return (
    <div className="wz-stack" style={{ gap: 8 }}>
      <label htmlFor={`${id}-to`} className="wz-label">
        Base Sepolia address
      </label>
      <div className="wz-field" data-size="sm" data-invalid={Boolean(r.toError)}>
        <input
          id={`${id}-to`}
          autoComplete="off"
          spellCheck={false}
          placeholder="0x..."
          value={r.to}
          disabled={disabled}
          aria-invalid={Boolean(r.toError)}
          aria-describedby={`${id}-to-hint`}
          onChange={(e) => r.setTo(e.target.value)}
          onBlur={r.touchTo}
        />
      </div>
      <p id={`${id}-to-hint`} className={r.toError ? "wz-error" : "wz-hint"}>
        {r.toError ?? "The address that receives the USDC. Check it: a transfer to the wrong address cannot be undone."}
      </p>
    </div>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────

const STEP_STATE = { todo: "next", running: "now", done: "done", failed: "next", skipped: "next" } as const;

/** The two steps of receiving as XLM or on Base Sepolia, step 2's action, and the recovery state. */
export function ReceiveSteps({ r, walletName }: { r: Receive; walletName: string }) {
  const leg = r.leg;
  if (!leg) return null;
  const v = r.view;
  const usdc = formatUsdc(leg.amount);
  const second = leg.option === "xlm" ? "Swap to XLM" : "Send to Base Sepolia";
  const s = r.second;

  return (
    <section className="ln-recv-steps wz-stack" aria-label="Receive steps">
      <ol className="wz-steps" aria-live="polite">
        <li data-state={STEP_STATE[v.steps[0]]}>
          {v.steps[0] === "running" ? <Spinner /> : <i aria-hidden="true" />}
          <span>
            Step 1: Borrow <span className="mono">{usdc}</span> USDC
          </span>
        </li>
        <li data-state={STEP_STATE[v.steps[1]]}>
          {v.steps[1] === "running" ? <Spinner /> : <i aria-hidden="true" />}
          <span>Step 2: {second}</span>
          {s.kind === "done" && leg.option === "xlm" ? (
            <ExternalLink href={stellarTxUrl(s.hash)} className="wz-link mono">
              {shortAddress(s.hash, 6, 4)}
            </ExternalLink>
          ) : null}
        </li>
      </ol>

      {v.recovery ? (
        <Recovery r={r} />
      ) : v.active === 2 && leg.option === "xlm" ? (
        <SwapStep r={r} walletName={walletName} />
      ) : v.active === 2 && leg.option === "base" ? (
        <SendStep r={r} walletName={walletName} />
      ) : null}

      {r.burnHash ? <CctpProgress burnHash={r.burnHash} status={r.cctp} /> : null}
      {s.kind === "done" && leg.option === "xlm" ? (
        <Notice tone="positive" label="Done">
          <p>Swapped to XLM. It&apos;s in your Stellar wallet. You still owe the USDC you borrowed.</p>
        </Notice>
      ) : null}
    </section>
  );
}

function Recovery({ r }: { r: Receive }) {
  const xlm = r.leg?.option === "xlm";
  const s = r.second;
  return (
    <Notice
      tone="info"
      label={s.kind === "failed" ? "Step 2 didn't go through" : "Step 2 skipped"}
      actions={
        <button type="button" className="wz-btn wz-btn-gold" onClick={() => (xlm ? void r.quote() : void r.send())}>
          {xlm ? "Convert now" : "Send now"}
        </button>
      }
    >
      <p>You have your USDC. Nothing was lost. {xlm ? "Convert now?" : "Send it to Base Sepolia now?"}</p>
      {s.kind === "failed" ? <ErrorBox error={s.error} label="What happened" tone="warning" /> : null}
    </Notice>
  );
}

function SwapStep({ r, walletName }: { r: Receive; walletName: string }) {
  const s = r.second;
  if (s.kind === "quoting") return <Running>Getting a quote</Running>;
  if (s.kind === "signing") return <Running>Checking the quote again, then confirm in {walletName}</Running>;
  if (s.kind !== "quoted") return null;
  const q = s.quote;
  return (
    <div className="wz-stack" style={{ gap: 12 }}>
      {r.priceMoved && (
        <Notice tone="warning" label="The price moved">
          <p>The quote changed since you saw it. Check the new minimum, then swap again.</p>
        </Notice>
      )}
      <dl className="ln-est">
        <div className="wz-row">
          <dt>You swap</dt>
          <dd className="mono">{formatUsdc(q.amountInStroops)} USDC</dd>
        </div>
        <div className="wz-row">
          <dt>You get about</dt>
          <dd className="mono">{formatUsdc(q.amountOutStroops)} XLM</dd>
        </div>
        <div className="wz-row">
          <dt>At least</dt>
          <dd>
            <span className="mono">{formatUsdc(q.minOutStroops)} XLM</span>
            <small>
              Slippage <span className="mono">{formatBp(q.slippageBp)}</span>. Below this the swap fails and you keep the USDC.
            </small>
          </dd>
        </div>
      </dl>
      <p className="wz-hint">The quote is checked again just before you sign. Testnet XLM.</p>
      <div className="wz-actions">
        <button type="button" className="wz-btn wz-btn-gold" onClick={() => void r.swap()}>
          Swap to XLM
        </button>
        <button type="button" className="wz-btn wz-btn-text" onClick={r.skip}>
          Keep USDC
        </button>
      </div>
    </div>
  );
}

function SendStep({ r, walletName }: { r: Receive; walletName: string }) {
  const s = r.second;
  const leg = r.leg!;
  if (s.kind === "signing") return <Running>Confirm in {walletName}</Running>;
  if (s.kind === "done") return null;
  return (
    <div className="wz-stack" style={{ gap: 12 }}>
      <dl className="ln-est">
        <div className="wz-row">
          <dt>You send</dt>
          <dd className="mono">{formatUsdc(leg.amount)} USDC</dd>
        </div>
        <div className="wz-row">
          <dt>To</dt>
          <dd>
            <span className="mono">{leg.to ? shortAddress(leg.to, 6, 4) : "-"}</span>
            <small>Base Sepolia testnet</small>
          </dd>
        </div>
      </dl>
      <div className="wz-actions">
        <button type="button" className="wz-btn wz-btn-gold" onClick={() => void r.send()}>
          Send to Base Sepolia
        </button>
        <button type="button" className="wz-btn wz-btn-text" onClick={r.skip}>
          Keep USDC on Stellar
        </button>
      </div>
    </div>
  );
}

function Running({ children }: { children: React.ReactNode }) {
  return (
    <div className="wz-status" aria-live="polite">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

/** "Sent from Stellar", "Circle confirms", "Arrived", each with its transaction once there is one. */
export function CctpProgress({ burnHash, status }: { burnHash: string; status: CctpStatus | null }) {
  const steps = cctpSteps(burnHash, status);
  return (
    <div className="wz-stack" style={{ gap: 8 }}>
      <ol className="wz-steps" aria-label="Transfer to Base Sepolia" aria-live="polite">
        {steps.map((st) => (
          <li key={st.label} data-state={st.state === "failed" ? "next" : st.state}>
            {st.state === "now" ? <Spinner /> : <i aria-hidden="true" />}
            <span>{st.label}</span>
            {st.tx ? (
              <ExternalLink href={st.tx.chain === "stellar" ? stellarTxUrl(st.tx.hash) : baseSepoliaTxUrl(st.tx.hash)} className="wz-link mono">
                {shortAddress(st.tx.hash, 6, 4)}
              </ExternalLink>
            ) : null}
          </li>
        ))}
      </ol>
      {status?.kind === "failed" ? (
        <Notice tone="warning" label="Not arrived">
          <p>Circle hasn&apos;t confirmed this transfer: {status.reason}. The USDC left Stellar in the transaction linked above; keep that link if you report it.</p>
        </Notice>
      ) : status?.kind === "arrived" ? (
        <p className="wz-hint">Arrived on Base Sepolia. Testnet USDC.</p>
      ) : (
        <p className="wz-hint">Circle usually confirms within a few minutes. You can leave this page; the transfer continues.</p>
      )}
    </div>
  );
}
