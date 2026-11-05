# Testnet evidence: lender yield, relayer recovery and the Lend tab

Everything below is public: merged pull requests in this repository, transactions on Stellar testnet and Bitcoin signet, and the live app. No link needs a login.

Contract: `writz-lend` [`CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS`](https://stellar.expert/explorer/testnet/contract/CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS), deployed at ledger 5,516,974. Deployment record: [`contracts/deployments/testnet.md`](../../../contracts/deployments/testnet.md).

## Lender yield (#277)

Lenders who supply USDC earn the interest borrowers pay, net of the 15% protocol fee. A lender's withdrawable balance grows with the supply index and the interest is paid out on withdrawal.

| Evidence | Link |
|---|---|
| Supply index and scaled lender balances | #255, PR #282 |
| Events carry the scaled amount and the supply index | #257, PR #370 |
| Projected read views (`get_pool_totals`, `get_supply_position`) | #256, PR #374 |
| Property test of the lender invariants, 2,000 sequences, each invariant checked by a mutation | #258, PR #381 |
| Client bindings regenerated for the app and the relayer | #259, PR #371 |
| Testnet redeploy carrying the views and the tested code | #377, PR #382 |
| Lender documentation matching the deployed contract | #262, PR #391 |
| Supply, borrow, repayment and a withdrawal above the principal | #261, PR #394, [`lender-yield-testnet.md`](lender-yield-testnet.md) |

The recorded run, every row a live testnet transaction:

| Step | Transaction | Ledger | Amount |
|---|---|---|---|
| Lender supplies | [`7e2da7b16e...`](https://stellar.expert/explorer/testnet/tx/7e2da7b16e04d9f52a2cf22d451fb20a65781da1cd8ef769927a3affe6219d19) | 5,517,384 | 50.0000000 USDC |
| Bitcoin deposit registered | [`5c392069de...`](https://stellar.expert/explorer/testnet/tx/5c392069de7750d25833067b38d1b64d528de7c8969dda33f6c986bce6f8a127) | 5,517,627 | 5,000 sats |
| Borrow | [`0ac50113f1...`](https://stellar.expert/explorer/testnet/tx/0ac50113f1d589e6185deee5aa399aa0503362baf5dcc334e0307937df1da2e1) | 5,517,628 | 2.0000000 USDC |
| Full repayment with interest | [`c70e22f8e2...`](https://stellar.expert/explorer/testnet/tx/c70e22f8e26639d2ecd9ba39f474d593325bf8d79bea4a7a8266d10193126592) | 5,536,105 | 2.0000317 USDC |
| Lender withdraws everything | [`e495ee90a4...`](https://stellar.expert/explorer/testnet/tx/e495ee90a4795e034380fcd2d3a0740710acf0340642f0279b752a05075e4bc1) | 5,536,108 | 50.0000415 USDC |

The lender withdrew 415 stroops more than they supplied. That is the supply index growth applied to the principal: `500,000,000 x (1.000000830302919432 - 1) = 415.15`, rounded down, as the contract does. A second loan stays open, so the pool keeps a borrow rate above 0.

## Relayer recovery (#278)

The relayer's state is rebuilt from public Stellar data and checked against the chain before it is used. A lost database no longer skips a repayment, and anyone can start their own relayer.

| Evidence | Link |
|---|---|
| Persisted pending releases, retried until published; the repay watcher never starts from the chain tip | #379, PR #384 |
| Append-only archive of `writz-lend` events | #378, PR #385 |
| `rebuild-lend-state`: replay from RPC, verified against the chain, swapped in only if every check passes | #380, PR #386 |
| Archive export, and rebuild from the export past RPC retention | #266, PR #393 |
| Recovery runbook and command reference, followed from a fresh clone and an empty data directory | #268, PRs #387 and #404, [`relayer-recovery.md`](../relayer-recovery.md) |
| Live relayer health, with `lendEvents` and `releases` | [`api.testnet.writz.xyz/health`](https://api.testnet.writz.xyz/health) |
| Recovery drill on testnet, recorded | #273. **Pending** |

## Lend tab (#279)

| Evidence | Link |
|---|---|
| Lend flows and reads on `writz-lend` | #270, PR #376 |
| Supply rate and balance with accrued interest | #271, PR #389 |
| Copy, states and tests for an interest-bearing pool | #272, PR #390 |
| Wallet picker usable from the keyboard | PR #402 |
| Live Lend tab, open to anyone | [testnet.writz.xyz/lend](https://testnet.writz.xyz/lend) |
| Demo video: supply, wait, withdraw more than supplied | #274. **Pending** |

## Review pass

#275 ran before the evidence was recorded, and is closed: contract, relayer and app suites, clippy, lint and builds; the property test at 10 times its CI case count; the Lend tab at 360, 768 and 1280 px with no console errors; keyboard-only wallet connection; and the deployment record against every environment.

## Not done

- **Recovery drill video (#273)** and **Lend tab video (#274)**: not recorded yet. This file links them when they are.
- **Light theme**: the app ships a dark theme only (`color-scheme: dark`), so there is no light theme to check.
- **Forced publish failure on the live relayer**: covered by the tests of PR #384. The live relayer published the release of the repaid loan above, but a failure was not forced on testnet.
- **Bitcoin release of the repaid loan**: the repayment is on Stellar. Releasing the 5,000 sats on signet is a step the borrower signs and is not part of this run.
