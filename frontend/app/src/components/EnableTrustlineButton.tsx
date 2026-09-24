"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { hasTrustline, enableTrustline, type ClassicAsset } from "@/lib/flows/trustline";
import { humanizeError } from "@/lib/errors";

/**
 * Shows a one-click prompt when the connected account lacks a trustline for
 * `asset`. Renders nothing once the trustline exists.
 *
 * The asset is a required prop rather than a default, because this component
 * is rendered against two different assets - the pool's USDC in the borrow
 * dashboard and the vault's USDC in Earn - and a default would silently give
 * one of them the other's trustline. That is the exact bug this prop exists to
 * make impossible.
 */
export function EnableTrustlineButton({
  asset,
  reason,
}: {
  asset: ClassicAsset;
  /** Why the user needs it, e.g. "to receive borrowed funds". */
  reason: string;
}) {
  const { address, signTransaction } = useWallet();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address || !asset.issuer) return;
    let cancelled = false;
    void (async () => {
      const ok = await hasTrustline(address, asset);
      if (!cancelled) setEnabled(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [address, asset]);

  if (!address || !asset.issuer || enabled === null || enabled) return null;

  async function handleEnable() {
    if (!address) return;
    setError(null);
    setWorking(true);
    try {
      await enableTrustline({ address, asset, signTransaction });
      setEnabled(true);
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber/40 bg-amber/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-body">
          Enable {asset.code} {reason} - adds a trustline (one signature, and
          0.5 XLM stays reserved while it exists).
        </span>
        <button
          type="button"
          onClick={handleEnable}
          disabled={working}
          className="shrink-0 rounded-full border border-amber/60 bg-amber/10 px-3.5 py-1.5 text-xs font-semibold text-amber transition-colors hover:bg-amber/20 disabled:opacity-50"
        >
          {working ? "Enabling…" : `Enable ${asset.code}`}
        </button>
      </div>
      {error ? <p className="break-all text-xs text-crit">{error}</p> : null}
    </div>
  );
}
