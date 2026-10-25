"use client";

import { BTC_NETWORK_LABEL, config } from "@/config";
import { shortAddress } from "@/lib/borrow/journey";
import { btcTxUrl, stellarTxUrl } from "@/lib/explorer";
import { networkName } from "@/lib/wallet/precheck";
import { ExternalLink } from "@/components/ui";

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
    <section className="wz-proof" aria-label="Deposit status">
      {verified ? (
        <p className="wz-proof-seal" data-moment={moment} role="status">
          <i aria-hidden="true" />
          Verified on Stellar
        </p>
      ) : null}
      <dl className="wz-proof-rows">
        <div className="wz-row">
          <dt>Bitcoin transaction</dt>
          <dd>
            <ExternalLink href={btcTxUrl(btcTxid)} className="wz-link mono">
              {shortAddress(btcTxid, 8, 6)}
            </ExternalLink>
            <small>mempool.space, {BTC_NETWORK_LABEL}</small>
          </dd>
        </div>
        {confirmations ? (
          <div className="wz-row">
            <dt>Confirmations required</dt>
            <dd className="mono">{confirmations}</dd>
          </div>
        ) : null}
        <div className="wz-row">
          <dt>Stellar transaction</dt>
          <dd>
            {stellarTxHash ? (
              <>
                <ExternalLink href={stellarTxUrl(stellarTxHash)} className="wz-link mono">
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
