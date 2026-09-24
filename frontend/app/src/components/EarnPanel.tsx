"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { earnApi, type VaultPosition } from "@/lib/earn/api";
import { usePolledValue } from "@/lib/earn/usePolledValue";
import { EarnPosition } from "./EarnPosition";
import { EarnDeposit } from "./EarnDeposit";
import { EarnWithdraw } from "./EarnWithdraw";

/**
 * The Earn tab: live position and APY (#110), the deposit flow (#109), and the
 * withdraw flow (#111).
 *
 * The panel owns both reads. The position is needed twice - to display, and to
 * cap what withdraw will let the user take out - and polling it separately in
 * each place would let the number on screen and the number enforced drift
 * apart, with the user believing the one they can see.
 *
 * `refreshKey` is what makes a landed transaction show up immediately: it is
 * part of the poll key, so bumping it forces a re-read rather than leaving the
 * user waiting out the interval. Polling remains the safety net for everything
 * this tab did not cause: accrued yield, or a deposit made on another device.
 */
const POSITION_POLL_MS = 15_000;
// APY is vault-wide and moves with Blend's utilisation, not with anything this
// user does, so it does not need the position's cadence.
const APY_POLL_MS = 60_000;

export function EarnPanel() {
  const { address } = useWallet();
  const [refreshKey, setRefreshKey] = useState(0);

  // Both readers take everything from their `key` argument and close over
  // nothing, so they stay stable with an empty dependency list - which is what
  // usePolledValue needs to keep its interval alive across renders.
  const readPosition = useCallback(
    (key: string) => earnApi().getPosition(key.split(":")[0]!),
    [],
  );
  const readApy = useCallback(() => earnApi().getApy(), []);

  const position = usePolledValue<VaultPosition>(
    address ? `${address}:${refreshKey}` : null,
    readPosition,
    POSITION_POLL_MS,
  );
  const apy = usePolledValue<number>("vault", readApy, APY_POLL_MS);

  const refresh = () => setRefreshKey((n) => n + 1);

  return (
    <div className="flex flex-col gap-12">
      <EarnPosition position={position} apy={apy} />
      <EarnDeposit onDeposited={refresh} />
      <EarnWithdraw
        available={position.value?.underlyingStroops ?? null}
        onWithdrawn={refresh}
      />
    </div>
  );
}
