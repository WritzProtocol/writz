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
| Replay from RPC reads past long quiet stretches: an empty page short of the latest ledger no longer ends it | PR #425 |
| Recovery on video: relayer data deleted, a repayment while it is down, rebuild from the exported archive matching the chain, both releases co-signed after the restart | #274, [demo video](#demo-video), part 2, [`demo-testnet.md`](demo-testnet.md#relayer-recovery-as-filmed) |

## Lend tab (#279)

| Evidence | Link |
|---|---|
| Lend flows and reads on `writz-lend` | #270, PR #376 |
| Supply rate and balance with accrued interest | #271, PR #389 |
| Copy, states and tests for an interest-bearing pool | #272, PR #390 |
| Wallet picker usable from the keyboard | PR #402 |
| Live Lend tab, open to anyone | [testnet.writz.xyz/lend](https://testnet.writz.xyz/lend) |
| Supply, wait and withdraw more than supplied, from the browser: 8 USDC in, 8.0000213 USDC out | #274, [demo video](#demo-video), part 3, [`demo-testnet.md`](demo-testnet.md) |

## Demo video

One session, #274, recorded on 2026-11-09, shows all three on testnet in the order a user meets them: a lender and a Bitcoin borrower on the Lend tab, the interest arriving, the relayer recovering from a deleted database while the borrower repays, and the lender withdrawing more than they supplied. Every hash in it is listed in [`demo-testnet.md`](demo-testnet.md), with what it does not show.

| Video | Link |
|---|---|
| Full session, 6:14: lender yield (0:08), relayer recovery (2:10), Lend tab (4:30) | [Google Drive](https://drive.google.com/file/d/18sCNGmoquCxf8Gln8J0hW1aOEn09WCPk/view?usp=sharing) |
| Product walkthrough, 2:31 | [youtu.be/aFWK09AYcuU](https://youtu.be/aFWK09AYcuU) |

## Review pass

#275 ran before the evidence was recorded, and is closed: contract, relayer and app suites, clippy, lint and builds; the property test at 10 times its CI case count; the Lend tab at 360, 768 and 1280 px with no console errors; keyboard-only wallet connection; and the deployment record against every environment.

## Not done

- **Demo video (#274), against its plan**: the repayment made while the relayer was down was not a full repayment (it left 0.0000055 USDC of accrued interest), so the session shows no missing release being recovered; that path is covered by the tests of PRs #384 and #386. The rebuild filmed reads the exported archive, because the RPC replay stopped early during the session; fixed in PR #425 and verified from RPC afterwards. The contract's views are not shown next to the rebuilt values; the rebuild checks them itself. Details in [`demo-testnet.md`](demo-testnet.md#what-the-session-does-not-show).
- **Light theme**: the app ships a dark theme only (`color-scheme: dark`), so there is no light theme to check.
- **Forced publish failure on the live relayer**: covered by the tests of PR #384. The live relayer published the release of the repaid loan above, but a failure was not forced on testnet.
- **Bitcoin release of the loan repaid in the recorded lender run (#261)**: the repayment is on Stellar; that release is a step the borrower signs and was not part of the run. The demo session releases both of its loans on signet.
