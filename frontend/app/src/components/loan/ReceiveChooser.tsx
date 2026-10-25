"use client";

import { useId, useState } from "react";
import { config } from "@/config";
import { formatBp } from "@/lib/receive/format";
import { parseEvmAddress, receiveOptions, type ReceiveChoiceDraft } from "@/lib/receive/options";
import { DEFAULT_SLIPPAGE_BP } from "@/lib/receive/swap";

/** The options this deployment can deliver: XLM and Base Sepolia only when their contracts are configured. */
export const RECEIVE_OPTIONS = receiveOptions({
  swap: Boolean(config.receive.soroswapRouter && config.receive.xlmToken),
  cctp: Boolean(config.receive.cctp.tokenMessengerMinter),
  eurc: config.receive.eurc,
});

/** "Receive as": USDC on Stellar, XLM on Stellar or USDC on Base Sepolia, with the Base Sepolia address. */
export function ReceiveChooser({
  draft,
  onChange,
  disabled,
}: {
  draft: ReceiveChoiceDraft;
  onChange: (d: ReceiveChoiceDraft) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  if (RECEIVE_OPTIONS.length < 2) return null;
  const parsed = parseEvmAddress(draft.to);
  const toError = draft.option === "base" && (touched || draft.to) && !parsed.ok ? parsed.error : null;

  return (
    <div className="wz-stack" style={{ gap: 8 }}>
      <p className="wz-label" id={`${id}-label`}>
        Receive as
      </p>
      <div className="wz-chips ln-recv" role="group" aria-labelledby={`${id}-label`}>
        {RECEIVE_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className="wz-chip ln-recv-opt"
            aria-pressed={draft.option === o.id}
            disabled={disabled || o.id === "eurc"}
            onClick={() => {
              setTouched(false);
              onChange({ ...draft, option: o.id });
            }}
          >
            <span>{o.label}</span>
            <small>{o.id === "eurc" ? "No testnet liquidity yet" : o.network}</small>
          </button>
        ))}
      </div>
      {draft.option === "xlm" && (
        <p className="wz-hint">
          Two signatures: borrow USDC, then convert it to XLM at the price shown, with slippage up to{" "}
          <span className="mono">{formatBp(DEFAULT_SLIPPAGE_BP)}</span>. Your debt stays in USDC; if the price of XLM moves, what you owe in
          XLM terms changes.
        </p>
      )}
      {draft.option === "base" && (
        <>
          <p className="wz-hint">
            Your debt stays in USDC on Stellar. After the borrow, the USDC is sent to Base Sepolia for you, so you need no wallet there.
          </p>
          <label htmlFor={`${id}-to`} className="wz-label">
            Base Sepolia address
          </label>
          <div className="wz-field" data-size="sm" data-invalid={Boolean(toError)}>
            <input
              id={`${id}-to`}
              autoComplete="off"
              spellCheck={false}
              placeholder="0x..."
              value={draft.to}
              disabled={disabled}
              aria-invalid={Boolean(toError)}
              aria-describedby={`${id}-to-hint`}
              onChange={(e) => onChange({ ...draft, to: e.target.value })}
              onBlur={() => setTouched(true)}
            />
          </div>
          <p id={`${id}-to-hint`} className={toError ? "wz-error" : "wz-hint"}>
            {toError ?? "The address that receives the USDC. Check it: a transfer to the wrong address cannot be undone."}
          </p>
        </>
      )}
    </div>
  );
}
