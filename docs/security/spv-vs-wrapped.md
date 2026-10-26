---
title: "SPV vs Wrapped Bitcoin"
description: "Where an SPV light client differs from wrapped Bitcoin and bridges, and where it shares their risks."
---

**Wrapped Bitcoin, bridges and SPV: what actually differs.**

Writz never wraps Bitcoin. Your BTC stays on Bitcoin, in a script that only your key can spend alone after the time-lock, and Stellar learns about it through an SPV light client: a Soroban contract (`bitcoin-spv`) that checks Bitcoin block headers and Merkle proofs. People sometimes ask whether an SPV light client is "just another bridge". It is not, but it is not free of trust either. The tables below say exactly where the difference lies.

Items marked **planned** are not built yet. They stay marked until they ship. The mechanisms that are live today are described in the [Security Model](/security/security-model) and in [How SPV Verification Works](/how-it-works/spv-verification).

---

## Who holds the Bitcoin, and who can move it

| | Custodial wrapped BTC | Multisig or federated bridge | Bitcoin staking with slashing (Babylon-style) | Writz (SPV light client) |
|---|---|---|---|---|
| Where the BTC sits | With a custodian | In an address controlled by a group of signers | In the staker's own script | In the user's own script, one output per position |
| Who can move it | The custodian | Any quorum of the signers | Only the script's paths; slashing needs proof of misbehaviour | Only the script's paths: user and protocol together, or the user alone after the time-lock |
| Can the operator take the BTC | Yes | Yes, with a quorum | No | No |
| Is there a pooled reserve to steal | Yes | Yes | No | No |
| What represents the BTC on the other chain | A token, transferable | A token, transferable | A staking position | A loan position; no Bitcoin token is minted |
| If the operator disappears | Token holders hold an unbacked claim | Token holders hold an unbacked claim | The staker unbonds through the script | The user spends the time-lock path with their own key |

## Trust assumptions

| Assumption | Custodial wrapped BTC | Multisig or federated bridge | Writz (SPV light client) |
|---|---|---|---|
| Honest custodian or signers | Required | Required (k of n) | Not required for custody |
| Bitcoin proof of work | Not used | Not used | Required: headers must carry real work, and the most-work chain wins |
| Data delivery | The custodian attests | Signers watch Bitcoin | At least one honest relayer submits headers in time. Relayers cannot forge mainnet headers, only delay them |
| Verifier code is correct | Minting logic | Bridge verifier (where Wormhole and Nomad failed) | Light client: headers, difficulty, chainwork, Merkle proofs. Open source, with no upgrade entry point, tested against real Bitcoin headers |
| Starting point | None | None | A checkpoint block, set once and never changed afterwards, publicly checkable against any Bitcoin node |
| Price oracle | For lending use | For lending use | For lending use (the same as any lending protocol) |

On testnet the light client follows Bitcoin signet. Signet blocks are authenticated by a block signature the contract does not check, and signet proof of work is cheap, so on testnet header submission is restricted to the Writz relayer. The proof-of-work argument on this page applies to Bitcoin mainnet.

## What happens when each part fails

| Failure | Custodial wrapped BTC | Multisig or federated bridge | Writz (SPV light client) |
|---|---|---|---|
| Keys stolen | All reserves at risk | All reserves at risk once a quorum is stolen | No key can spend a user's script alone. The protocol co-signing key can only refuse to co-sign, and the user still exits after the time-lock |
| Verifier bug | Unbacked tokens minted, redeemable for real BTC | Unbacked tokens minted, redeemable for real BTC | Collateral that does not exist could be credited, so lenders' USDC is at risk, bounded by the global borrow cap (a per-borrower cap is planned). Users' BTC is not touched |
| Relayers stop | Not applicable | Peg-ins and peg-outs stop | The light client's view of Bitcoin stops advancing. New loans should stop until it catches up (planned: an on-chain freshness rule). Existing BTC stays where it is |
| Deep Bitcoin reorg | The custodian absorbs or socialises it | The bridge may have minted against reorged deposits | A deposit confirmed by fewer blocks than the reorg could be undone. Writz plans 6 confirmations on mainnet; the deepest mainnet reorgs on record are from 2010 and 2013 |
| Operator shuts down | Redemption depends on the custodian | Redemption depends on the signers | Users recover their BTC with their own key after the time-lock |

## Where SPV really does share risk with a bridge

| Shared risk | Why | How Writz addresses it |
|---|---|---|
| Verification code can have bugs | A light client is code that decides what counts as a confirmed Bitcoin payment | A small, open-source verifier with no upgrade path, so code cannot be swapped under users (a fix ships as a new deployment). Planned: an independent audit before mainnet, and hardening of proof-depth binding and median-time-past |
| Someone must deliver data | Headers have to be submitted to Stellar | Planned: permissionless submission on mainnet, several independent relayers, and a monitor that compares the on-chain tip with several Bitcoin sources and pauses new loans if it falls behind |
| Privileged roles | Whoever configures the verifier is trusted for what that role can do | No role can rewrite stored headers or the checkpoint once it is set. The admin can still choose who may submit headers and which lending contracts may consume deposits, and the lending contract's admin can point it at a different verifier or pause new loans. Planned: these admin accounts move to a 2-of-3 multisig before mainnet |
| Starting point | The checkpoint is trusted once | It is public, and anyone can compare it with a Bitcoin node |

## What it costs to attack each model

| Model | To forge a deposit or mint | Notes |
|---|---|---|
| Custodial wrapped BTC | Compromise or coerce one custodian | One organisation |
| Multisig or federated bridge | Compromise k of n signers, or find a verifier bug | Ronin: 5 of 9 keys. Harmony Horizon: two keys |
| Writz (SPV light client), relayers live | Out-mine the Bitcoin network | Majority hash power |
| Writz (SPV light client), relayers stalled, mainnet with open submission | Mine the required confirmations privately at full difficulty | About six blocks of mainnet work, worth roughly 18.8 BTC in forgone rewards at the time of writing (October 2026). This is why new loans must stop when the light client falls behind, and why exposure caps stay far below that figure |

## Track record

| System | Model | What happened |
|---|---|---|
| [Ronin bridge, 2022](https://home.treasury.gov/news/press-releases/jy0768) | Multisig of validators | About 625M USD taken with 5 of 9 validator keys |
| [Wormhole, 2022](https://kudelskisecurity.com/research/quick-analysis-of-the-wormhole-attack) | Guardian signatures | 120,000 wETH minted through a signature-verification bypass |
| [Nomad, 2022](https://immunefi.com/blog/bug-fix-reviews/hack-analysis-nomad-bridge-august-2022/) | Optimistic verifier | About 190M USD after an upgrade made every message valid |
| [Harmony Horizon, 2022](https://securityaffairs.com/141266/apt/harmony-horizon-bridge-lazarus-apt.html) | Multisig | About 100M USD after two multisig keys were compromised |
| [Multichain, 2023](https://www.dlnews.com/articles/defi/multichain-halts-use-of-crypto-bridge-saying-ceo-arrested/) | MPC custody | About 125M USD moved out; operational control of the keys sat with one person |
| [WBTC, 2024](https://bitgo.com/resources/blog/bitgo-to-move-wbtc-to-multi-jurisdictional-custody-to-accelerate-global/) | Custodian | Custody moved to a new joint venture; several integrators reduced or ended exposure |
| [BTC Relay, 2016](https://github.com/ethereum/btcrelay) | SPV relay on Ethereum | No forgery on record; depended on volunteers paid per header to keep relaying |
| [tBTC v1, 2020](https://blog.keep.network/details-of-the-tbtc-deposit-pause-on-may-18-2020/) | SPV relay plus bonded signers | Paused three days after launch for a redemption bug, not an SPV forgery; users' BTC was not at risk |

Figures are as reported by the linked post-mortems, announcements and press coverage.

## How Writz keeps the light client honest

| Layer | Status | What it does |
|---|---|---|
| Proof of work, difficulty and chainwork checks on every header | Live | Rejects headers without the required work and follows the most-work chain |
| Merkle proof against a stored header, 64-byte transaction refusal | Live | A transaction is accepted only if it is in a block the light client already accepted |
| Confirmation depth | Live, set per deployment | 6 confirmations planned on mainnet |
| Exposure caps | Global cap live, per-borrower cap planned | Bound what any verification failure could cost lenders |
| Proof-depth binding, median-time-past | Planned | Close known SPV edge cases |
| On-chain freshness rule | Planned | Loans that depend on the Bitcoin tip are refused when the tip is too old |
| Multiple relayers, permissionless submission | Planned for mainnet | Any honest relayer keeps the light client live |
| Independent monitor with automatic pause of new loans | Planned for mainnet | Compares the on-chain tip with several Bitcoin sources; can only pause new deposits and borrows, never move funds |
| Zero-knowledge proof of the Bitcoin header chain as a second check | Researching | An independent cryptographic check that needs no trusted signer; it could only refuse a tip, never credit value |

---

**Next:** [Audits →](/security/audits)
