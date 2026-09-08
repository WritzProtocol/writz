"use client";

import { useCallback } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { earnApi, type VaultPosition } from "@/lib/earn/api";
import { usePolledValue } from "@/lib/earn/usePolledValue";
import { fmtUsdc } from "@/lib/earn/amount";
import { EARN_ASSET } from "@/lib/flows/trustline";
import { config } from "@/config";

/**
 * The signed-in user's live position in the Writz DeFindex vault, and the
 * vault's current APY (#110).
 *
 * Both are polled rather than read once: a deposit or withdrawal changes the
 * position, and yield changes it continuously without anything happening in
 * this tab. The acceptance criterion is that it reflects live relayer reads
 * without a manual page reload, so the interval is the mechanism and the
 * timestamp is the proof.
 *
 * `refreshKey` lets the deposit and withdraw flows force a read the moment
 * their transaction lands, instead of leaving the user staring at a stale
 * balance until the next tick.
 */
const POSITION_POLL_MS = 15_000;
// APY is a vault-wide figure that moves with Blend's utilisation, not with
// anything this user does, so it does not need the position's cadence.
const APY_POLL_MS = 60_000;

export function EarnPosition({ refreshKey = 0 }: { refreshKey?: number }) {
  const { address } = useWallet();

  // Both readers derive everything from their `key` argument and close over
  // nothing, so they are stable with an empty dependency list - which is what
  // usePolledValue needs to keep its interval alive across renders.
  const readPosition = useCallback(
    (key: string) => earnApi().getPosition(key.split(":")[0]!),
    [],
  );
  const readApy = useCallback(() => earnApi().getApy(), []);

  // The key carries refreshKey so a landed deposit re-reads immediately.
  const position = usePolledValue<VaultPosition>(
    address ? `${address}:${refreshKey}` : null,
    readPosition,
    POSITION_POLL_MS,
  );
  const apy = usePolledValue<number>("vault", readApy, APY_POLL_MS);

  const balance = position.value?.underlyingStroops ?? null;
  const shares = position.value?.dfTokens ?? null;
  const unreachable = position.value === null && position.error !== null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">
          {address ? "Your Earn position" : "Writz USDC vault"}
        </h2>
        <LiveIndicator
          updatedAt={address ? position.updatedAt : apy.updatedAt}
          stale={(address ? position.error : apy.error) !== null}
        />
      </div>

      {!address ? (
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Metric label="Current APY" hint="from the Blend strategy, via DeFindex">
              {apy.value !== null
                ? `${(apy.value * 100).toFixed(2)}%`
                : apy.loading
                  ? "…"
                  : "-"}
            </Metric>
            <Metric label={`Deposit asset · ${EARN_ASSET.code}`} hint="Blend testnet USDC">
              {EARN_ASSET.issuer
                ? `${EARN_ASSET.issuer.slice(0, 4)}…${EARN_ASSET.issuer.slice(-4)}`
                : "-"}
            </Metric>
          </div>
          <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
            The APY above is read live from the vault, no wallet needed. Sign in
            to see your own position.
          </p>
        </div>
      ) : unreachable ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          We can&apos;t reach the relayer to read your vault position right now.
          Your funds are unaffected - this is a read, and it retries on its own.
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <Metric label={`Your balance · ${EARN_ASSET.code}`} hint="what your shares are worth now">
              {balance !== null ? fmtUsdc(balance) : position.loading ? "…" : "-"}
            </Metric>
            <Metric label="Current APY" hint="from the Blend strategy, via DeFindex">
              {apy.value !== null
                ? `${(apy.value * 100).toFixed(2)}%`
                : apy.loading
                  ? "…"
                  : "-"}
            </Metric>
            <Metric label="Vault shares · dfTokens" hint="held by your account, not by Writz">
              {shares !== null ? fmtUsdc(shares) : position.loading ? "…" : "-"}
            </Metric>
          </div>

          {balance !== null && shares !== null && balance > shares ? (
            <p className="mt-4 border-t border-line pt-3 text-xs text-ok">
              Your shares are worth {fmtUsdc(balance - shares)} {EARN_ASSET.code}{" "}
              more than the shares themselves. That difference is the yield the
              strategy has earned.
            </p>
          ) : balance === 0n ? (
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              No position yet. Deposit below to start earning.
            </p>
          ) : null}
        </div>
      )}

      {config.earn.mock ? (
        <p className="text-xs text-amber">
          Mock mode: these numbers are held in memory for this tab only.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Shows when the numbers were last read. "Live" is a claim, and a claim the
 * user cannot check is worth less than a timestamp they can.
 */
function LiveIndicator({
  updatedAt,
  stale,
}: {
  updatedAt: Date | null;
  stale: boolean;
}) {
  if (!updatedAt) return <span className="text-xs text-muted">reading…</span>;
  const time = updatedAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span
        className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-amber" : "bg-ok"}`}
        aria-hidden
      />
      {stale ? `last good read ${time}` : `updated ${time}`}
    </span>
  );
}

function Metric({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-mono text-lg tabular-nums text-hi">{children}</span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}
