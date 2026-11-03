# Lender yield on testnet

Contract `CD3BRE32LDNDHAEVI6H35UC3NIRREW5BLH64AZMHSQY3LEKYDLKYWBXS`. The lender supplied 50.0000000 USDC and withdrew 50.0000415 USDC, 415 stroops more.

Lender account `GDHMA2XQLFEX56Q2M7FKSMG422Y3RPPO7WVJIWHCPD635NRJ3ACMUTKA`. Produced by `scripts/evidence/lender_yield_testnet.mjs`. Every row is a live testnet transaction.

| Step | Transaction | Ledger | Amount | `supply_index` | Lender balance after |
|---|---|---|---|---|---|
| lender supply | [`7e2da7b16e...`](https://stellar.expert/explorer/testnet/tx/7e2da7b16e04d9f52a2cf22d451fb20a65781da1cd8ef769927a3affe6219d19) | 5517384 | 50.0000000 USDC | 1000000000000000000 | 50.0000000 |
| kept loan deposit | [`a423d4c972...`](https://stellar.expert/explorer/testnet/tx/a423d4c9728b3ccb211bca454b7220e333ab970898ec638eea79e21928541272) | 5517589 | 5000 sats | 1000000000000000000 | 50.0000000 |
| kept loan borrow | [`cc646a7058...`](https://stellar.expert/explorer/testnet/tx/cc646a70582ab540699bac31a843953f6ff86914d90cfd18e6991e0c90092536) | 5517590 | 2.0000000 USDC | 1000000000000000000 | 50.0000000 |
| evidence loan deposit | [`5c392069de...`](https://stellar.expert/explorer/testnet/tx/5c392069de7750d25833067b38d1b64d528de7c8969dda33f6c986bce6f8a127) | 5517627 | 5000 sats | 1000000000000000000 | 50.0000000 |
| evidence loan borrow | [`0ac50113f1...`](https://stellar.expert/explorer/testnet/tx/0ac50113f1d589e6185deee5aa399aa0503362baf5dcc334e0307937df1da2e1) | 5517628 | 2.0000000 USDC | 1000000000000000000 | 50.0000000 |
| evidence loan repay 1 | [`c70e22f8e2...`](https://stellar.expert/explorer/testnet/tx/c70e22f8e26639d2ecd9ba39f474d593325bf8d79bea4a7a8266d10193126592) | 5536105 | 2.0000317 USDC | 1000000830302919432 | 50.0000415 |
| lender withdrawal | [`e495ee90a4...`](https://stellar.expert/explorer/testnet/tx/e495ee90a4795e034380fcd2d3a0740710acf0340642f0279b752a05075e4bc1) | 5536108 | 50.0000415 USDC | 1000000830302919432 | 0.0000000 |

The kept loan stays open, so the pool keeps a rate above 0: Bitcoin transaction `16ba10a25b7a7bda61782ccc0e852887d56130a49fe6f917072c87725a39f665`.
