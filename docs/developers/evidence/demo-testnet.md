# Demo on testnet, 2026-11-09

One session on [testnet.writz.xyz](https://testnet.writz.xyz) and the live relayer, recorded between about 05:00 and 07:45 UTC on 2026-11-09 against `writz-lend` [`CD3BRE32...`](https://stellar.expert/explorer/testnet/contract/CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS). A lender supplies USDC on the Lend tab, a borrower who signed in with a social login locks Signet Bitcoin and borrows, the relayer loses its database while the borrower repays, the state is rebuilt and checked against the contract, both loans are repaid and released, and the lender withdraws more than they supplied.

| Video | Link |
|---|---|
| Full session, 6:14, in three parts: lender yield (0:08), relayer recovery (2:10), Lend tab (4:30) | [Google Drive](https://drive.google.com/file/d/18sCNGmoquCxf8Gln8J0hW1aOEn09WCPk/view?usp=sharing) |
| Product walkthrough, 2:31, from the borrower's side | [youtu.be/aFWK09AYcuU](https://youtu.be/aFWK09AYcuU) |

Waits for Bitcoin and Stellar confirmations are cut and labelled on screen. Every hash below is public.

## Stellar testnet

| # | Step | Transaction | Ledger | Amount |
|---|---|---|---|---|
| 1 | Lender supplies | [`7921bf6afd...`](https://stellar.expert/explorer/testnet/tx/7921bf6afd210bfae29dab24f035fa1db00b5a79c189cd85dc423af4e2f722ad) | 5,635,290 | 5.0000000 USDC |
| 2 | Loan 1: Bitcoin deposit registered | [`1df27fa782...`](https://stellar.expert/explorer/testnet/tx/1df27fa78278c784ec4ba0d34fbb9e000d5200ab02b414702afbc5cae719c3a7) | 5,635,483 | 5,000 sats, timelock block 383,000 |
| 3 | Loan 1: borrow | [`5a579669f3...`](https://stellar.expert/explorer/testnet/tx/5a579669f3b3ad5e7d02d8a812e153c685c7bd82a668578c2b8756b861cd2e6e) | 5,635,516 | 2.4800000 USDC |
| 4 | Lender supplies more | [`0d3b3c7222...`](https://stellar.expert/explorer/testnet/tx/0d3b3c72222641ba3c155bfd4cfa97f08c2997c6ed817e15707fca6704fdcda1) | 5,635,654 | 3.0000000 USDC |
| 5 | Loan 2: Bitcoin deposit registered | [`3778ba67e0...`](https://stellar.expert/explorer/testnet/tx/3778ba67e05c297012e9c9107e1f2b06687610decd01a8f325f235cf3c6e760c) | 5,635,786 | 13,000 sats, timelock block 383,000 |
| 6 | Loan 2: borrow | [`4f933b5bc3...`](https://stellar.expert/explorer/testnet/tx/4f933b5bc31f1f3ab315e1cca57d5a7c29bfd43aa6c34b001e96c01bda6b0878) | 5,635,799 | 1.1900000 USDC |
| 7 | Loan 2: repayment while the relayer is down | [`f15b220705...`](https://stellar.expert/explorer/testnet/tx/f15b22070526b1088e98cb6fcdfb2273b5cb7015a4ab7ed3049758a267aabdba) | 5,636,429 | 1.1900000 USDC |
| 8 | Loan 1: repayment after the restart | [`cf39b2eaba...`](https://stellar.expert/explorer/testnet/tx/cf39b2eabaab570e730b1984b391bf161ea47b6d3572c137c363bc103df7b741) | 5,636,590 | 2.4800000 USDC |
| 9 | Loan 1: repaid in full (`repay_full`) | [`a319d8903d...`](https://stellar.expert/explorer/testnet/tx/a319d8903d92a29e0114f46c127c146127d866d2d260b8e292b7e47391049d16) | 5,636,820 | remaining interest |
| 10 | Loan 2: repaid in full (`repay_full`) | [`084fb98f0e...`](https://stellar.expert/explorer/testnet/tx/084fb98f0e507e998b8b974b26be4b60b8ec6620ca0bbc033381ae3ff96317d6) | 5,636,878 | remaining interest |
| 11 | Lender withdraws everything | [`9fa04b1d48...`](https://stellar.expert/explorer/testnet/tx/9fa04b1d48b166d4d47f8843f69831d4d4c339eb6754bd4e19bd14c30bfead32) | 5,636,936 | 8.0000213 USDC |

The lender supplied 8 USDC in two steps and withdrew 8.0000213 USDC: 213 stroops of interest paid by the two borrowers, net of the protocol fee. The supply index moved from 1.000228429929656044 at the first supply to 1.000231321858963023 at the withdrawal, both read from the contract's events.

## Bitcoin signet

| Step | Transaction | Block |
|---|---|---|
| Test Bitcoin from the app's faucet | [`a9b73da00b...`](https://mempool.space/signet/tx/a9b73da00b3009c7817d466e6e5bec9f9e6d42a2f9672f9abc508cdb112d243e) | |
| Loan 1 deposit | [`5c4522a05a...`](https://mempool.space/signet/tx/5c4522a05a0cfcc23a59f726f5cf19592028e5154229908d36048ee0262a0bff) | 330,041 |
| Loan 2 deposit | [`b3bfe4e1cc...`](https://mempool.space/signet/tx/b3bfe4e1cc40dd4c9f0b674742d3d88116ea35e05c28d6cb4f49c696f6344f59) | 330,043 |
| Loan 1 release, co-signed by the recovered relayer | [`b3df5e162b...`](https://mempool.space/signet/tx/b3df5e162b1eda942a2e7d7d6fb813b01e7e63111d5afcc6fad560dc2fe9ca19) | 330,057 |
| Loan 2 release, co-signed by the recovered relayer | [`16438915711...`](https://mempool.space/signet/tx/16438915711c21d2bbff4a3244987f1c705da24928ce7414e00680bec08e1996) | 330,057 |

## Relayer recovery, as filmed

Part 2 of the full session, from 2:10. The relayer was put into maintenance (start command `sleep infinity`) until `/health` stopped answering, then, inside its container:

```bash
ls -la data/
rm -f data/lend-events.db* data/watcher.db*
ls -la data/
```

With the relayer down, the borrower repaid loan 2 (row 7). The state was then rebuilt from the event archive exported before the deletion (`data/lend-archive.ndjson`, 17 events, ledgers 5,516,982 to 5,635,799), first as a dry run and then for real:

```bash
bun run rebuild-lend-state --dry-run --source archive --file data/lend-archive.ndjson
bun run rebuild-lend-state --source archive --file data/lend-archive.ndjson
```

```text
Events replayed:      18
Positions verified:   4
Suppliers verified:   3
Total scaled supply:  129981795
Repaid in full:       1
Missing releases:     0
Verified against the chain and swapped in.
```

The relayer restarted with `releases.pending` at 0 and `lendEvents.ok` true, and co-signed both releases above.

After the session, with PR #425 merged, the same rebuild from public RPC from the deployment ledger:

```text
$ bun run rebuild-lend-state --dry-run
Events replayed:      22
Positions verified:   4
Suppliers verified:   3
Total scaled supply:  50000083
Repaid in full:       3
Missing releases:     0
Verified against the chain. Dry run: nothing changed.
```

## What the session does not show

- **A release recovered by the rebuild.** The repayment made while the relayer was down (row 7) repaid the 1.19 USDC borrowed but left 0.0000055 USDC of interest that had accrued, so it was not a full repayment and no release was missing: the rebuild reported 0. The repayment in full came after the restart (row 10), and the recovered relayer co-signed that release. Finding and publishing a missing release is covered by the tests of PRs #384 and #386.
- **The rebuild from RPC on screen.** During the session the replay from RPC stopped early and the rebuild refused to swap in, with a mismatch on the total scaled supply. Cause: Stellar RPC scans a bounded ledger window per `getEvents` request, and an empty page short of the latest ledger was read as the chain tip. Fixed in PR #425 with a regression test. The rebuild filmed is the one from the exported archive, which is the path this repository documents for a relayer past RPC retention; the RPC dry run above was run after the fix.
- **The contract's views next to the rebuilt values.** `get_supply_position` and `get_pool_totals` are not shown on screen. `rebuild-lend-state` checks every position, every lender's scaled balance and the total against the contract and changes nothing on any mismatch.
