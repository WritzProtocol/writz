"use client";

import { appOutboxDeps, appOutboxOwner } from "@/lib/relayer/appOutbox";
import { useRelayerOutbox } from "@/lib/relayer/useRelayerOutbox";

/**
 * Keeps the relayer outbox running for the connected wallet and, once an
 * update has failed 10 times, says so until it goes through (#267). Nothing
 * is abandoned silently: the update stays queued and keeps retrying.
 */
export function RelayerOutboxNotice({ address }: { address: string | null }) {
  const { stuck, retryNow, retrying } = useRelayerOutbox(address ? appOutboxOwner(address) : null, appOutboxDeps);
  if (stuck.length === 0) return null;

  const what = stuck.length === 1 ? "An update for the relayer has" : `${stuck.length} updates for the relayer have`;
  const lastError = stuck[0].lastError;
  return (
    <section role="status" aria-live="polite" className="hm-guard flex flex-col gap-2">
      <p className="text-sm">
        {what} not gone through after 10 tries. Your transaction on chain is safe; this only keeps the relayer&apos;s copy of
        the tree in step. It keeps retrying on its own.
      </p>
      {lastError ? <p className="text-xs text-muted break-all font-mono">Last error: {lastError}</p> : null}
      <div>
        <button type="button" className="wz-btn wz-btn-line wz-btn-sm" onClick={() => void retryNow()} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry now"}
        </button>
      </div>
    </section>
  );
}
