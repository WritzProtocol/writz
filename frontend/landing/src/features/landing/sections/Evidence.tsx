import { DOCS_URL, GITHUB_URL } from "../constants";
import { explorerUrl, ledger } from "../data/contracts.data";

export function Evidence() {
  return (
    <section id="evidence" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head" data-reveal>
          <div>
            <p className="eyebrow">Don&apos;t take our word for it</p>
            <h2>The protocol runs on contracts you can read.</h2>
          </div>
          <a className="link-rule" href={GITHUB_URL}>
            Read the source
          </a>
        </div>
        <div className="ledger" data-reveal>
          <div className="row head">
            <div>Contract</div>
            <div className="role">What it does</div>
            <div>Address on Stellar testnet</div>
          </div>
          {ledger.map((c) => (
            <div className="row" key={c.address}>
              <div className="name mono">{c.name}</div>
              <div className="role">{c.role}</div>
              <a className="addr mono" href={explorerUrl(c.address)} target="_blank" rel="noreferrer">
                {c.address}
              </a>
            </div>
          ))}
        </div>
        <div className="facts" data-reveal>
          <span>Open source under Apache 2.0.</span>
          <span>
            Not audited yet.{" "}
            <a className="link-rule" href={`${DOCS_URL}/security/security-model`}>
              Read the security model
            </a>
          </span>
          <span>Live on Stellar testnet. Not on mainnet yet.</span>
        </div>
      </div>
    </section>
  );
}
