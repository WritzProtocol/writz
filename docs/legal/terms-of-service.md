# Terms of Service

Effective date: August 17, 2026

Status: Writz is currently deployed on Soroban Testnet and Bitcoin Signet only. No mainnet deployment with real user funds exists at the time of writing. These terms apply to the testnet application, the public website, and will continue to apply once a mainnet deployment goes live, subject to the update process described below.

## 1. What Writz Is

Writz Protocol is open source smart contract software deployed on the Stellar network (Soroban) and secured in part by Bitcoin Script on the Bitcoin network. Writz is not a company offering financial services, not a bank, not a broker, and not a custodian. Nobody at Writz holds, controls, or has access to user funds at any point. Collateral is locked by a Bitcoin Script (P2WSH) that only the depositing user and the protocol's verification logic can act on, under the conditions encoded in that script.

References to "Writz," "the protocol," or "we" in this document mean the open source software and the individuals contributing to its development, not a registered financial institution, unless a specific legal entity is named in a future revision of this document.

## 2. No Custody, No Intermediary

Writz does not take custody of Bitcoin, USDC, or any other asset. All actions (depositing collateral, borrowing, repaying, and withdrawing) are executed directly by the user through their own Bitcoin and Stellar wallets, verified on-chain by public smart contract logic. There is no step in the protocol where a Writz-controlled account can unilaterally move user funds outside the rules encoded in the contracts.

## 3. Eligibility and Prohibited Use

By using Writz, you represent that:

- You are not a resident of, or located in, a jurisdiction subject to comprehensive sanctions under the U.S. Office of Foreign Assets Control (OFAC), the European Union, or the United Nations Security Council.
- You are not included on any OFAC Specially Designated Nationals list or equivalent sanctions list maintained by the jurisdictions referenced above.
- You are not using Writz to launder funds, finance terrorism, evade sanctions, or facilitate any other illegal activity.
- You are solely responsible for determining whether your use of Writz complies with the laws of your own jurisdiction.

The Writz frontend may implement address or IP-based screening against sanctioned jurisdictions and known sanctioned addresses. This screening happens at the frontend level, not inside the smart contracts, which remain permissionless by design.

## 4. Risks You Accept

Using Writz involves risks inherent to experimental financial software. By using the protocol, you acknowledge and accept:

- **Smart contract risk.** The Soroban contracts, the Bitcoin locking scripts, and the zero-knowledge circuits may contain undiscovered bugs, despite testing and any completed audits. A bug could result in partial or total loss of deposited collateral.
- **Zero-knowledge circuit risk.** The privacy layer depends on the correctness of the Circom circuits and the security of the trusted setup ceremony. A flaw in either could, in principle, allow an invalid proof to be accepted.
- **Bitcoin and Stellar network risk.** Writz depends on the underlying security, liveness, and finality guarantees of both the Bitcoin and Stellar networks. Congestion, reorganizations, or protocol-level issues on either network can delay or affect your ability to interact with the protocol.
- **Oracle risk.** Liquidations and collateral valuation depend on price oracle data. Oracle failure or manipulation, while mitigated by design, is not impossible.
- **Early-stage software risk.** Writz is early-stage software under active development. Interfaces, contract addresses, and mechanics may change between testnet and mainnet, and after mainnet launch as the protocol matures.
- **No warranty.** Writz is provided "as is," without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement.

## 5. No Financial Advice

Nothing in the Writz documentation, website, or interface constitutes financial, investment, legal, or tax advice. You are responsible for your own decisions and for consulting qualified professionals where appropriate.

## 6. Limitation of Liability

To the maximum extent permitted by applicable law, contributors to Writz Protocol are not liable for any direct, indirect, incidental, consequential, or special damages arising from your use of, or inability to use, the protocol, including but not limited to loss of funds, loss of data, or loss of profits.

## 7. Changes to These Terms

These terms may be updated as Writz moves from testnet to mainnet, as a legal entity is formed, and as the protocol's compliance posture matures (see Section 3). Material changes will be reflected in this document with an updated effective date and, where practical, announced through the project's public channels.

## 8. Contact

Questions about these terms can be raised through the project's public GitHub repository at github.com/WritzProtocol/writz.
