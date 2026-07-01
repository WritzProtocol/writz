"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { hasUsdcTrustline, enableUsdcTrustline } from "@/lib/flows/trustline";
import { config } from "@/config";

/**
 * Shows a one-click "Enable USDC" prompt when the connected account lacks a
 * trustline for the pool's USDC asset (needed to receive borrowed funds).
 * Renders nothing once the trustline exists.
 */
export function EnableUsdcButton() {
  const { address, signTransaction } = useWallet();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address || !config.usdc.issuer) return;
    let cancelled = false;
    void (async () => {
      const ok = await hasUsdcTrustline(address);
      if (!cancelled) setEnabled(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address || !config.usdc.issuer || enabled === null || enabled) return null;

  async function handleEnable() {
    if (!address) return;
    setError(null);
    setWorking(true);
    try {
      await enableUsdcTrustline({ address, signTransaction });
      setEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber/40 bg-amber/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-body">
          Enable USDC to receive borrowed funds — adds a trustline (one signature, no fee beyond the base).
        </span>
        <button
          type="button"
          onClick={handleEnable}
          disabled={working}
          className="shrink-0 rounded-full border border-amber/60 bg-amber/10 px-3.5 py-1.5 text-xs font-semibold text-amber transition-colors hover:bg-amber/20 disabled:opacity-50"
        >
          {working ? "Enabling…" : "Enable USDC"}
        </button>
      </div>
      {error ? <p className="break-all text-xs text-crit">{error}</p> : null}
    </div>
  );
}
