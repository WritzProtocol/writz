import { DOCS_URL, GITHUB_URL } from "../constants";
import { explorerUrl, ledger } from "../data/contracts.data";

export function Evidence() {
  return (
    <section id="evidence" className="proof" aria-labelledby="proof-h">
      <div className="wrap board">
        <div className="ptile head" data-reveal>
          <h2 id="proof-h">The protocol runs on contracts you can read.</h2>
          <a className="textlink" href={GITHUB_URL}>
            Read the source
          </a>
        </div>
        {ledger.map((c) => (
          <div className="ptile" key={c.address} data-reveal>
            <p className="nm">{c.name}</p>
            <p className="rl">{c.role}</p>
            <a
              className="addr"
              href={explorerUrl(c.address)}
              target="_blank"
              rel="noreferrer"
              aria-label={`${c.name} on Stellar Expert, address ${c.address}`}
            >
              {c.address}
            </a>
          </div>
        ))}
        <div className="ptile facts2" data-reveal>
          <p>Open source under Apache 2.0.</p>
          <p>
            Not audited yet. <a href={`${DOCS_URL}/security/security-model`}>Read the security model</a>
          </p>
          <p>Live on Stellar testnet. Not on mainnet yet.</p>
        </div>
      </div>
    </section>
  );
}
