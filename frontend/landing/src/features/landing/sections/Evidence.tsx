import { DOCS_URL, GITHUB_URL } from "../constants";
import { explorerUrl, ledger } from "../data/contracts.data";
import * as l from "../styles";

export function Evidence() {
  return (
    <section id="evidence" className={l.proof} aria-labelledby="proof-h">
      <div className={l.board}>
        <div className={l.proofHead} data-reveal>
          <h2 id="proof-h">The protocol runs on contracts you can read.</h2>
          <a className={l.proofHeadLink} href={GITHUB_URL} data-umami-event="read-source" data-umami-event-where="evidence">
            Read the source
          </a>
        </div>
        {ledger.map((c) => (
          <div className={l.contract} key={c.address} data-reveal>
            <p className={l.contractName}>{c.name}</p>
            <p className={l.contractRole}>{c.role}</p>
            <a
              className={l.contractAddress}
              href={explorerUrl(c.address)}
              data-umami-event="contract-explorer"
              data-umami-event-label={c.name}
              target="_blank"
              rel="noreferrer"
              aria-label={`${c.name} on Stellar Expert, address ${c.address}`}
            >
              {c.address}
            </a>
          </div>
        ))}
        <div className={l.proofFacts} data-reveal>
          <p>Open source under Apache 2.0.</p>
          <p>
            Not audited yet. <a href={`${DOCS_URL}/security/security-model`} data-umami-event="security-model" data-umami-event-where="evidence">Read the security model</a>
          </p>
          <p>Live on Stellar testnet. Not on mainnet yet.</p>
        </div>
      </div>
    </section>
  );
}
