"use client";

import { BTC_NETWORK_LABEL, config } from "@/config";
import { shortAddress } from "@/lib/borrow/journey";
import { btcTxUrl, stellarTxUrl } from "@/lib/explorer";
import { networkName } from "@/lib/wallet/precheck";
import { ExternalLink } from "@/components/ui";
import * as ui from "@/components/ui/styles";

const STELLAR = networkName(config.networkPassphrase);

/**
 * The deposit and its two transactions. Once `writz-lend` accepted the SPV
 * proof (`verified`: the Stellar transaction settled, or the position is on
 * chain) it carries a gold "Verified on Stellar" seal. With `moment` the seal
 * sweeps in once (about a second, none under reduced motion); its end state
 * is the same static seal.
 */
export function DepositProof({
  btcTxid,
  stellarTxHash,
  confirmations,
  verified,
  moment = false,
}: {
  btcTxid: string;
  stellarTxHash: string | null;
  verified: boolean;
  /** The deployment's required count, when known. */
  confirmations?: number | null;
  moment?: boolean;
}) {
  return (
    <section className="grid gap-1 self-stretch" aria-label="Deposit status">
      {verified ? (
        <p
          className="[--cut:16px] flex items-center gap-3 py-[14px] pr-5 pl-7 bg-accent text-on-accent text-[16px] font-semibold [clip-path:polygon(var(--cut)_0,100%_0,100%_100%,0_100%,0_calc(var(--cut)/var(--shear)))] [&>i]:w-2 [&>i]:h-[15px] [&>i]:bg-on-accent [&>i]:-skew-x-16 [&>i]:flex-none data-[moment=true]:animate-wz-seal"
          data-moment={moment}
          role={moment ? "status" : undefined}
        >
          <i aria-hidden="true" />
          Verified on Stellar
        </p>
      ) : null}
      <dl className="m-0 py-1 px-5 bg-surface-2 [&_dd_small]:block [&_dd_small]:text-muted">
        <div className={ui.row()}>
          <dt>Bitcoin transaction</dt>
          <dd>
            <ExternalLink href={btcTxUrl(btcTxid)} className={ui.monoLink}>
              {shortAddress(btcTxid, 8, 6)}
            </ExternalLink>
            <small>mempool.space, {BTC_NETWORK_LABEL}</small>
          </dd>
        </div>
        {confirmations ? (
          <div className={ui.row()}>
            <dt>Confirmations required</dt>
            <dd className="mono">{confirmations}</dd>
          </div>
        ) : null}
        <div className={ui.row()}>
          <dt>Stellar transaction</dt>
          <dd>
            {stellarTxHash ? (
              <>
                <ExternalLink href={stellarTxUrl(stellarTxHash)} className={ui.monoLink}>
                  {shortAddress(stellarTxHash, 8, 6)}
                </ExternalLink>
                <small>stellar.expert, {STELLAR}</small>
              </>
            ) : verified ? (
              "Recorded on Stellar"
            ) : (
              "Not registered yet"
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
