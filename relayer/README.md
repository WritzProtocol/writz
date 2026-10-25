# Writz Relayer

Bitcoin SPV proof relayer for the Writz Protocol. Fetches transaction data from Esplora and assembles an SPV proof bundle ready for submission to the `bitcoin-spv` Soroban contract.

## API

### `GET /spv-proof/:txid`

Returns an SPV proof bundle for the given Bitcoin transaction ID.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `confirmations` | integer (1–20) | `6` | Minimum confirmations required |

**Responses**

| Status | `error` | Meaning |
|---|---|---|
| `200` | | Proof bundle returned |
| `400` | `invalid_txid`, `invalid_confirmations` | Invalid `txid` format or `confirmations` value |
| `404` | `unconfirmed` | Transaction is known but not in a block yet |
| `404` | `tx_not_found` | The Esplora indexer does not know this txid (typo, wrong network, or not broadcast yet) |
| `409` | `insufficient_confirmations` | Not enough Bitcoin confirmations yet (`requested`, `available`) |
| `409` | `light_client_behind` | The block is on Bitcoin, but `bitcoin-spv` does not hold it yet or not deep enough, so `verify_transaction` would fail with `HeaderNotFound` (#22) or `InsufficientConfirmations`. Body: `requested`, `available` (depth the light client can attest), `blockHeight`, `lightClientTipHeight`, `retryAfterSeconds`; also a `Retry-After` header. Retry after the next header-sync pass |
| `429` | `rate_limited` | Per-IP budget spent (`SPV_PROOF_RATE_LIMIT` per `SPV_PROOF_RATE_WINDOW_MS`). `retryAfterSeconds` and `Retry-After` say when to retry |
| `502` | `upstream_error` | Unexpected Esplora answer |
| `503` | `upstream_unavailable` | Esplora rate limited or unavailable after retries (and after the fallback host, when one is set). `retryAfterSeconds` and `Retry-After` say when to retry |

**Caching.** Proofs are cached in memory per `txid` and `confirmations`. A proof whose block is at least 6 deep below the Bitcoin tip is kept for `SPV_PROOF_CACHE_TTL_MS` (default 1 hour); a shallower proof, and the `unconfirmed`, `tx_not_found` and `insufficient_confirmations` answers, for 15 seconds. Upstream failures are never cached. Identical requests that arrive while a proof is being built share that one build. The light-client check runs on every request, cached or not, against the `bitcoin-spv` tip read at most every 5 seconds; it is skipped when `BITCOIN_SPV_ID` is unset or the read fails.

**200 body**

```json
{
  "txid": "...",
  "rawTxNoWitness": "...",
  "txIndex": 42,
  "merkleProof": ["..."],
  "headers": ["..."],
  "blockHeight": 800000,
  "confirmations": 6,
  "sorobanArgs": {
    "headers": ["..."],
    "merkle_proof": ["..."],
    "tx_index": 42,
    "raw_tx": "...",
    "min_confirmations": 6
  }
}
```

`sorobanArgs` is pre-formatted for direct use with the Stellar SDK / Soroban CLI.

### `GET /deposit-status/:txid`

Where a `writz-lend` deposit is, from the Bitcoin transaction to its registration on Stellar, for a deposit card to poll. `txid` is in display byte order, as explorers and wallets show it. Served only where lending is enabled, like `/spv-proof`.

**Query**

| Parameter | Required | Meaning |
|---|---|---|
| `stellarTx` | no | The hash the app got back when it submitted the `writz-lend` `deposit` call, 64 hex characters. Enables the `submitted` and `failed` stages and the `submission` object. Without it, `submission` is `null` and the stages are the Bitcoin ones plus `verified` |

**200 body**

```json
{
  "txid": "b7b74d273e9f5f210f97fec7374884e4800ea5f93aad64d5f86946867c2b8b6e",
  "stage": "verified",
  "confirmations": 155,
  "required": 1,
  "blockHeight": 327757,
  "proofReady": true,
  "lightClientTipHeight": 327911,
  "stellarTxHash": "020bdab6b5f8a576964b97b68c328e54ed5d0c0e572885ce8695fe8b18c6a6e6",
  "ledger": 5364245,
  "verifiedAt": "2026-10-24T12:26:52Z",
  "submission": null
}
```

| `stage` | Meaning |
|---|---|
| `unseen` | The Esplora indexer does not know the txid: not broadcast yet, not propagated to it yet, or the wrong network |
| `mempool` | Broadcast, not in a block. `confirmations` is 0 |
| `confirming` | In a block, and either `confirmations < required`, or the confirmations are there but `bitcoin-spv` does not hold the confirming headers yet (`proofReady: false`; the header sync submits them every `SPV_SYNC_INTERVAL_MS`) |
| `ready` | `GET /spv-proof/:txid?confirmations=<required>` will serve a proof that `bitcoin-spv` can verify now. Nothing on Stellar has registered the deposit yet |
| `submitted` | Only with `stellarTx`. The deposit call succeeded and the registration read has not caught up yet (`submission.status: "success"`), or Stellar RPC does not hold the transaction yet (`"not_found"`) while it could still land: the Bitcoin transaction is in a block and less than 6 minutes passed since this relayer first saw the hash named for this txid |
| `verified` | `writz-lend` registered the deposit. `stellarTxHash`, `ledger` and `verifiedAt` come from its `deposit` event, or from a successful `stellarTx` when the event is not indexed |
| `failed` | Only with `stellarTx`. The deposit call is in a ledger and failed; `submission.reason` says why. Nothing was registered, and a new submission is needed |

- `required` is the deployment's minimum, `Config::min_confirmations` read from the `writz-lend` contract's storage (1 on the testnet deployment, 6 on mainnet), never a value configured in the relayer.
- `verified` comes only from Stellar: a `deposit` event for this txid, or the contract's `Position` entry for it. The confirmation count alone never makes a deposit verified. A deposit registered before Stellar RPC's event retention (about 7 days on testnet) is `verified` with `stellarTxHash`, `ledger` and `verifiedAt` null.
- The deposit transaction is signed and submitted by the user's wallet, not by the relayer, and a failed call emits no event, so a submission is only observable when the app names it with `stellarTx`.
- When the Bitcoin read fails for a deposit that is already verified, the answer is still `200 verified`, with `confirmations`, `blockHeight` and `proofReady` null.
- `lightClientTipHeight` is read only once Bitcoin has enough confirmations, and is null before that or when the read fails. When it cannot be read, `proofReady` follows the Bitcoin depth, as the proof route does.

**`submission`**, with `stellarTx`:

```json
{
  "txid": "...",
  "stage": "failed",
  "confirmations": 3,
  "required": 1,
  "blockHeight": 327913,
  "proofReady": true,
  "lightClientTipHeight": 327915,
  "stellarTxHash": null,
  "ledger": null,
  "verifiedAt": null,
  "submission": {
    "stellarTxHash": "...",
    "status": "failed",
    "ledger": 5383001,
    "closedAt": "2026-10-25T14:29:41Z",
    "reason": "InvalidKeyProof",
    "errorCode": 25
  }
}
```

| `submission` field | Meaning |
|---|---|
| `status` | `not_found`: not in a ledger Stellar RPC holds (in flight, dropped, or never sent). `success` or `failed`: in a ledger, with that result |
| `ledger`, `closedAt` | The ledger that included the transaction and its close time; null for `not_found` |
| `reason` | For `failed`: the `WritzLendError` name when `writz-lend` returned the error (for example `InvalidKeyProof`, `ScriptPubKeyMismatch`, `Paused`); otherwise the first Soroban error in the diagnostic events (`Error(Contract, #3221)` from another contract, `Error(Budget, ExceededLimit)`), otherwise the operation or transaction result code (`invokeHostFunctionTrapped`, `txBadAuth`) |
| `errorCode` | For `failed` with a contract error: its number |

- A `stellarTx` that Stellar RPC holds is checked before it is trusted: its envelope (or the inner transaction of a fee bump) must invoke `deposit` on this relayer's `writz-lend` with a `raw_tx` whose double SHA-256 is this txid, as `bitcoin-spv` derives it. Anything else is `400 stellar_tx_mismatch`, whatever the stage, so an unrelated hash cannot make a deposit look submitted or failed.
- A `not_found` hash cannot be checked, which is why it only yields `submitted` for the 6-minute window (the SDK builds the deposit with a 300 s time bound, plus a minute for RPC lag) and only once the Bitcoin transaction is in a block, since a deposit call needs its block hash and Merkle proof. After that the stage falls back to what Bitcoin says, with `submission.status: "not_found"`, which tells the app the transaction was dropped and can be submitted again. The window is kept in memory and restarts if the relayer restarts.
- A successful `stellarTx` is still `submitted`, not `verified`, until the registration is read from the contract; `verified` comes only from the chain.
- `failed` is the latest named submission. Once another submission registers the deposit, the stage is `verified` whatever the earlier hash says.

**Errors**

| Status | `error` | Meaning |
|---|---|---|
| `400` | `invalid_txid` | `txid` is not 64 hex characters |
| `400` | `invalid_stellar_tx` | `stellarTx` is present but not 64 hex characters, or repeated |
| `400` | `stellar_tx_mismatch` | `stellarTx` is on Stellar but is not a `writz-lend` `deposit` call for this txid |
| `429` | `rate_limited` | Per-IP budget spent (`DEPOSIT_STATUS_RATE_LIMIT` per `DEPOSIT_STATUS_RATE_WINDOW_MS`) |
| `502` | `upstream_error` | Unexpected Esplora answer |
| `503` | `upstream_unavailable` | Esplora rate limited or unavailable, for a deposit not verified on Stellar |
| `503` | `stellar_unavailable` | Stellar RPC could not be read, so `required`, the registration or the named `stellarTx` is not known; no stage is guessed |
| `503` | `lending_not_configured` | `WRITZ_LEND_ID` is not set on this relayer |

`429` and the `503` answers carry `retryAfterSeconds` and a `Retry-After` header, except `lending_not_configured`.

**Caching.** One answer per txid, or per txid and `stellarTx`, is shared for 5 seconds; failures are never kept. The Stellar transaction is found through an in-memory index of `writz-lend` position events (`deposit`, `borrow`, `repay`, `repay_full`, `liquidate`), shared with `/timeline`: it is built from the oldest ledger Stellar RPC retains when the relayer starts, then follows the tip from its cursor at most once every 5 seconds.

### `GET /timeline/:btcTxid`

The full cycle of one `writz-lend` position, one event per transaction, each with its explorer link: the Bitcoin lock, its verification and every borrow and repay on Stellar, how each borrow was received (a swap to XLM, or a CCTP burn and its mint on Base Sepolia), and the Bitcoin transaction that spent the lock. `btcTxid` is in display byte order. Served only where lending is enabled.

**200 body** (loan 1 on the testnet deployment: deposit, borrow taken as USDC, full repay, release)

```json
{
  "btcTxid": "b7b74d273e9f5f210f97fec7374884e4800ea5f93aad64d5f86946867c2b8b6e",
  "positionId": "6e8b2b7c864669f8d564ad3af9a50e80e4844837c7fe970f215f9f3e274db7b7",
  "owner": "GAXDQFQOZ645ZIZZCBZ6XPVHRDJ46OOIQ5RXU5G5KJNTZQ7AOM4DWP5L",
  "status": "Closed",
  "complete": true,
  "gaps": [],
  "events": [
    {
      "kind": "btc_lock",
      "chain": "bitcoin",
      "hash": "b7b74d273e9f5f210f97fec7374884e4800ea5f93aad64d5f86946867c2b8b6e",
      "at": 1792844759000,
      "url": "https://mempool.space/signet/tx/b7b74d273e9f5f210f97fec7374884e4800ea5f93aad64d5f86946867c2b8b6e"
    },
    {
      "kind": "verified",
      "chain": "stellar",
      "hash": "020bdab6b5f8a576964b97b68c328e54ed5d0c0e572885ce8695fe8b18c6a6e6",
      "at": 1792844812000,
      "url": "https://stellar.expert/explorer/testnet/tx/020bdab6b5f8a576964b97b68c328e54ed5d0c0e572885ce8695fe8b18c6a6e6"
    },
    {
      "kind": "borrowed",
      "chain": "stellar",
      "hash": "5be36a40cd29b5cc01caad910d6ff0b6a9c8ab49af691526af1be656e0851d05",
      "at": 1792844822000,
      "url": "https://stellar.expert/explorer/testnet/tx/5be36a40cd29b5cc01caad910d6ff0b6a9c8ab49af691526af1be656e0851d05"
    },
    {
      "kind": "repaid",
      "chain": "stellar",
      "hash": "e6c4335836ab7e0668e6908f1712f0c0196ca5c9c2f938b60303e067b619477f",
      "at": 1792844827000,
      "url": "https://stellar.expert/explorer/testnet/tx/e6c4335836ab7e0668e6908f1712f0c0196ca5c9c2f938b60303e067b619477f"
    },
    {
      "kind": "released",
      "chain": "bitcoin",
      "hash": "0a1482e31d2493967204e274eaa4df177cdd45347cbae874de30b5aab85e362d",
      "at": 1792846559000,
      "url": "https://mempool.space/signet/tx/0a1482e31d2493967204e274eaa4df177cdd45347cbae874de30b5aab85e362d"
    }
  ]
}
```

`kind`, `chain`, `hash`, `at` (Unix ms, null when unknown) and `detail` are the app's `TimelineEvent`, so the app can render `events` as they come; `url` is the explorer page of `hash` (mempool.space, stellar.expert, Basescan). `events` are in chain order, the order the app's `orderTimeline` produces.

| `kind` | `chain` | Source |
|---|---|---|
| `btc_lock` | `bitcoin` | The deposit transaction itself; `at` is its block time, null while unconfirmed |
| `verified` | `stellar` | The `writz-lend` `deposit` event |
| `borrowed` | `stellar` | Each `borrow` event |
| `received` | `stellar` | A swap of the borrowed USDC to XLM (`detail: "as XLM"`), or a CCTP `deposit_for_burn` towards Base Sepolia (`detail: "sent to Base Sepolia"`) |
| `received` | `base-sepolia` | The mint of that burn (`detail: "on Base Sepolia"`), when the CCTP relay on this relayer completed or observed it; `at` is when the relay recorded it |
| `repaid` | `stellar` | Each `repay` and `repay_full` event, and a `liquidate` event (`detail: "by liquidation"`) |
| `released` | `bitcoin` | The transaction that spent the deposit's P2WSH output (the cooperative release or the timelock path), found through Esplora's `outspends` |

Only transactions that exist are listed: a step not taken yet has no event. `owner` is the position's depositor, `status` its `PositionStatus`.

**How a borrow was received.** A swap or a burn is a second transaction the borrower signs after the borrow, and nothing on chain links it to the position. The relayer reads the owner's operations from Horizon, from the ledger of the first borrow on, and applies one rule: a successful `swap_exact_tokens_for_tokens` on the Soroswap router from the pool's USDC to XLM, or a successful `deposit_for_burn` of the pool's USDC from the owner to domain 6, sent by the owner, belongs to the owner's most recent `borrow` before it, unless a `borrow` or `repay` call by the owner on any position came in between. A leg after a borrow on another position belongs to that position; a leg after a repay belongs to none. The limit: an owner with two loans open who borrows on one and then swaps USDC that came from the other sees that swap under the latest borrow. Only direct calls to the router and the TokenMessengerMinter are matched, which is how the app sends them.

**Partial answers.** `writz-lend` must be readable; Bitcoin and Horizon only add steps. When either cannot be read, or the position is older than Stellar RPC's event window (about 7 days on testnet), the answer is still `200` with `complete: false` and a line per gap in `gaps`.

**Errors**

| Status | `error` | Meaning |
|---|---|---|
| `400` | `invalid_txid` | `btcTxid` is not 64 hex characters |
| `404` | `position_not_found` | `writz-lend` holds neither a `Position` nor an event for this txid; `/deposit-status` follows a deposit until then |
| `429` | `rate_limited` | Per-IP budget spent (`TIMELINE_RATE_LIMIT` per `TIMELINE_RATE_WINDOW_MS`) |
| `502` | `upstream_error` | Unexpected answer |
| `503` | `stellar_unavailable` | Stellar RPC could not be read |
| `503` | `lending_not_configured` | `WRITZ_LEND_ID` is not set on this relayer |

**Caching.** One answer per txid is shared for 10 seconds; failures are never kept.

### `GET /defindex/apy`

Returns the Writz DeFindex vault's current APY, read live through `@defindex/sdk`.

**Responses**

| Status | Meaning |
|---|---|
| `200` | APY returned |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error (`error` carries the `ContractError` variant name when the failure came from the vault contract) |

**200 body**

```json
{ "apy": 0.0721 }
```

`apy` is a fraction (`0.0721` = 7.21%), not a percentage - DeFindex's own API returns a percentage number, so this route converts it.

### `GET /defindex/position`

Returns a wallet's share of the Writz DeFindex vault.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `address` | Stellar `G...` public key | Required |

**Responses**

| Status | Meaning |
|---|---|
| `200` | Position returned |
| `400` | Missing or malformed `address` |
| `404` | Vault or position not found upstream |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error (`error` carries the `ContractError` variant name when the failure came from the vault contract) |

**200 body**

```json
{ "dfTokens": "12500000", "underlyingStroops": "12734512" }
```

Both fields are decimal strings of USDC stroops (7 decimals), never JSON numbers - a stroop amount above 2^53 loses precision as a double.

### `POST /defindex/deposit`

Builds an unsigned deposit transaction for the Writz DeFindex vault. The relayer never signs or
submits it - the connected wallet signs the returned XDR and the caller submits it to Soroban RPC
(non-custodial custody model, epic #101).

**Body**

| Field | Type | Description |
|---|---|---|
| `caller` | Stellar `G...` public key | Required. The depositor - also the transaction's source account. |
| `amountStroops` | decimal string | Required. USDC stroops (7 decimals) to deposit, as a positive integer string. |

**Responses**

| Status | Meaning |
|---|---|
| `200` | Unsigned deposit XDR returned |
| `400` | Missing or malformed `caller` or `amountStroops` |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error, or DeFindex resolved without an XDR to sign (`error` carries the `ContractError` variant name when the failure came from the vault contract) |

**Example**

```bash
curl -X POST http://localhost:3000/defindex/deposit \
  -H 'Content-Type: application/json' \
  -d '{"caller":"GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT","amountStroops":"10000000"}'
```

**200 body**

```json
{ "xdr": "AAAAAgAAAAA..." }
```

The deposit is invested into the vault's strategies immediately (`invest: true`), matching
DeFindex's own documented deposit flow - it doesn't sit idle waiting on a manual rebalance.

### `POST /defindex/withdraw`

Builds an unsigned withdraw transaction for the Writz DeFindex vault. The relayer never signs or
submits it - the connected wallet signs the returned XDR and the caller submits it to Soroban RPC
(non-custodial custody model, epic #101).

**Body**

| Field | Type | Description |
|---|---|---|
| `caller` | Stellar `G...` public key | Required. The withdrawer - also the transaction's source account. |
| `amountStroops` | decimal string | Required. USDC stroops (7 decimals) to withdraw, as a positive integer string. A full withdrawal is simply an amount equal to the caller's current position (see `GET /defindex/position`); there is no separate "withdraw all" flag. |

**Responses**

| Status | Meaning |
|---|---|
| `200` | Unsigned withdraw XDR returned |
| `400` | Missing or malformed `caller` or `amountStroops` |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error, or DeFindex resolved without an XDR to sign (`error` carries the `ContractError` variant name when the failure came from the vault contract) |

**Example**

```bash
curl -X POST http://localhost:3000/defindex/withdraw \
  -H 'Content-Type: application/json' \
  -d '{"caller":"GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT","amountStroops":"5000000"}'
```

**200 body**

```json
{ "xdr": "AAAAAgAAAAA..." }
```

### `GET /metrics/tvl`

Returns the Writz DeFindex vault's total value locked and its unique depositor count. Backs the vault figures on the app's public `/protocol` page.

**Responses**

| Status | Meaning |
|---|---|
| `200` | Metrics returned |
| `500` | `DEFINDEX_VAULT_ID` not configured |
| `502` | Upstream DeFindex error while reading the on-chain figure |

**200 body**

```json
{ "tvlStroops": "300199987", "onChainTvlStroops": "300310339", "uniqueDepositors": 4 }
```

- `tvlStroops` is net deposits minus withdrawals, summed from the vault events the relayer indexes. It needs no network call.
- `onChainTvlStroops` is the vault's live managed funds, read through `@defindex/sdk`. It includes the yield the strategy has accrued, so it is expected to sit slightly above `tvlStroops`. A gap larger than 20% of `tvlStroops` is logged as a warning rather than failing the request.
- `uniqueDepositors` counts distinct accounts that have ever deposited.

Both stroop fields are decimal strings (7 decimals), never JSON numbers.

### `GET /metrics/retention`

Returns 30-day retention cohorts for the vault, computed from the indexed events.

**200 body**

```json
{ "cohorts": [{ "cohort": "2026-09-02", "depositors": 1, "eligible": 0, "retained": 0 }] }
```

| Field | Meaning |
|---|---|
| `cohort` | UTC day of the depositors' first-ever deposit |
| `depositors` | Accounts whose first deposit fell on that day |
| `eligible` | Of those, how many have reached their 30-day mark. Younger depositors are too early to count as retained or churned, so they are left out |
| `retained` | Of the eligible, how many still held a positive net balance at their 30-day mark |

### `GET /metrics/onboarding` and `POST /metrics/onboarding/events`

The testnet onboarding funnel: how many people signed in, got a Signet test key, were paid by the faucet, deposited, borrowed, repaid and released. Mounted only where lending is enabled (never on the mainnet target). Stored in `data/onboarding.db` (`ONBOARDING_SQLITE_PATH`).

A person is a subject: the HMAC-SHA256 of their Stellar address under a secret generated once and kept in the same database. No address, Pollar id, email, profile or IP is stored, and the summary returns counts only. Every address is counted, team wallets included.

The app reports steps with `POST /metrics/onboarding/events`:

```json
{ "step": "borrow", "stellarAddress": "G...", "channel": "social", "txid": "<the loan's Bitcoin deposit txid>" }
```

- `step` is one of `sign_in`, `key_created`, `deposit`, `borrow`, `repay`, `release`; `channel` is `social` (Pollar sign-in) or `wallet`.
- `deposit`, `borrow`, `repay` and `release` need `txid`. The relayer reads that position on `writz-lend` and records the step only when the reporting address is its depositor and the position is in a state the step implies (debt or a closed loan for `borrow`, a closed loan for `release`). Otherwise it answers `403 not_owner` or `422 not_on_chain` / `step_not_reached`.
- `sign_in` and `key_created` happen in the browser and are recorded as reported.
- Each step is recorded once per subject; answers `202 { "recorded": true, "verified": true }`. Limited to `ONBOARDING_EVENTS_RATE_LIMIT` (60) per IP per `ONBOARDING_EVENTS_RATE_WINDOW_MS` (10 minutes).

Faucet claims are recorded by `POST /faucet/signet` itself, with their outcome: `paid` (Pollar confirmed a live social login of this app whose wallet is that address) or the refusal code.

`GET /metrics/onboarding` answers:

```json
{
  "asOf": "2026-10-25T12:00:00.000Z",
  "network": "testnet",
  "contract": "C...",
  "headline": { "activatedSocialUsers": 1, "socialUsersWithDeposit": 2 },
  "totals": { "sign_in": 2, "key_created": 1, "faucet_paid": 2, "deposit": 3, "borrow": 2, "repay": 1, "release": 1 },
  "social": { "sign_in": 2, "key_created": 1, "faucet_paid": 2, "deposit": 2, "borrow": 1, "repay": 0, "release": 0 },
  "faucetOutcomes": { "paid": 2, "account_already_claimed": 1 },
  "daily": [{ "day": "2026-10-25", "sign_in": 1, "key_created": 1, "faucet_paid": 1, "deposit": 1, "borrow": 1, "repay": 0, "release": 0 }],
  "definitions": { "...": "what each count means" }
}
```

- `headline.activatedSocialUsers`: addresses with a paid faucet claim, a verified deposit and a verified borrow.
- `totals` and `social` count distinct subjects per step; `daily` counts them by the UTC day each first reached the step.

### `POST /faucet/signet`

The Writz Signet faucet funds accounts created through the Writz testnet app's social login, and nobody else: it is not a public faucet. When a user signs in with Pollar (Google or GitHub) and the app creates their Signet test key, the app claims a fixed amount of Signet test BTC (default 20,000 sats, enough for one deposit at the testnet minimum plus fees and a retry) for that key's address, once. Builders and agents get Signet coins from public faucets such as [signetfaucet.com](https://signetfaucet.com). Mounted only on a Signet relayer that is not the mainnet target. Signet coins have no value.

A claim is two calls. First `GET /faucet/signet/nonce` answers `{ "nonce": "<32 hex>", "expiresAt": "<ISO time>" }`: a single-use challenge, valid five minutes. Then:

```json
{
  "pollarAccessToken": "<the SDK access token of the user's Pollar session>",
  "stellarAddress": "G...",
  "signetAddress": "tb1q...",
  "signetPubkey": "02...",
  "nonce": "<from /faucet/signet/nonce>",
  "keySig": "<base64 BIP-137 signature by signetPubkey>"
}
```

`keySig` signs, as a Bitcoin signed message, exactly `"Writz Signet faucet\nnonce:" + nonce + "\nstellar:" + stellarAddress + "\nsignet:" + signetAddress`. The relayer checks, in order: the shape of the body; that the nonce was issued, is unexpired and unused (it is spent by this request, whatever the outcome); that `signetAddress` is the P2WPKH address of `signetPubkey` and `keySig` recovers to that key; that the Stellar address and the Signet address have never claimed, and the per-IP and daily limits; then asks Pollar's Server API (`POST /v3/tokens/verify` with `POLLAR_SECRET_KEY`) whether the token is a live session of the Writz testnet app (`applicationId` equal to `POLLAR_APPLICATION_ID`, `network` testnet) whose wallet is a social-login (`internal`) wallet at `stellarAddress`; and last, that this Pollar account has never claimed. Email one-time-code logins do not claim unless `FAUCET_ALLOW_EMAIL=true`.

**200 body**

```json
{ "txid": "9a12...", "address": "tb1q...", "amountSats": 20000, "feeSats": 282, "explorerUrl": "https://mempool.space/signet/tx/9a12..." }
```

The transaction is unconfirmed when the call returns; Signet blocks come about every 10 minutes.

| Status | `error` | Meaning |
|---|---|---|
| `400` | `invalid_request` | A field is missing or malformed (including the old `{ "address": ... }` body) |
| `400` | `nonce_invalid` | The nonce is unknown, expired or already used: request a new one |
| `400` | `invalid_address` | `signetAddress` is not a Signet native SegWit address |
| `400` | `address_key_mismatch` | `signetAddress` is not the P2WPKH address of `signetPubkey` |
| `400` | `bad_signature` | `keySig` is not a signature by `signetPubkey` over this claim |
| `400` | `faucet_address` | The faucet's own address |
| `401` | `login_expired` | The Pollar access token expired: sign in again |
| `401` | `login_invalid` | Pollar does not recognise the token |
| `403` | `login_wrong_app` | The token belongs to another Pollar app |
| `403` | `login_wrong_network` | The token is not a testnet login |
| `403` | `login_not_social` | The login's wallet is a connected wallet or a smart account, not a social-login wallet |
| `403` | `login_address_mismatch` | `stellarAddress` is not the login's wallet |
| `403` | `login_provider_not_allowed` | Email one-time-code login while `FAUCET_ALLOW_EMAIL` is off |
| `409` | `account_already_claimed` | This Pollar account already claimed |
| `409` | `stellar_address_already_claimed` | This Stellar address already claimed |
| `409` | `signet_address_already_claimed` | This Signet address already received coins |
| `429` | `ip_cooldown` | This client IP used its allowance (default 20 claims per hour, sliding window); `retryAfterSeconds` is the time until its oldest claim leaves the window |
| `429` | `daily_cap_reached` | The faucet paid its daily maximum (default 300 claims); resets 00:00 UTC |
| `429` | `rate_limited` | Too many attempts from this IP (default 30 per 10 minutes) |
| `502` | `broadcast_rejected` | The Signet node refused the transaction; nothing was recorded, so the claim can be retried |
| `503` | `faucet_disabled` | No faucet key, no Pollar key or application id, or switched off with `FAUCET_ENABLED=false`; `reason` says which |
| `503` | `login_check_unavailable` | Pollar's Server API could not be reached, or refused the relayer's key |
| `503` | `faucet_empty` | The faucet wallet cannot cover the amount plus fee |
| `503` | `upstream_unavailable` | Esplora unavailable (after retries and the fallback host) |

`429` and `503` answers carry `retryAfterSeconds` and a `Retry-After` header when a wait is known. `faucet_disabled`, `faucet_empty`, `daily_cap_reached` and `upstream_unavailable` also list public Signet faucets in `publicFaucets`.

How it works: one send at a time (coin selection, signing and broadcast are serialized, and the outpoints a send spent are kept out of the next selection, so the faucet never double-spends its own coins); confirmed UTXOs first, largest first, then its own unconfirmed change; fee rate from Esplora's `/fee-estimates` for `FAUCET_FEE_TARGET_BLOCKS`, clamped to `[FAUCET_MIN_FEE_RATE, FAUCET_MAX_FEE_RATE]`; change back to the faucet address; broadcast through Esplora (`ESPLORA_URL`, then `ESPLORA_FALLBACK_URL`). Claims are stored in `data/faucet.db` (Signet address, Stellar address, SHA-256 of the Pollar user id, SHA-256 of the client IP, txid, amount, time; never the user's email or profile), with unique indexes on the account, the Stellar address and the Signet address, so the one-claim rules, the per-IP allowance and the daily count survive restarts when `/app/data` is a volume. A database from before claims needed a login is migrated in place, and the addresses it paid stay refused. The client IP is the one `TRUST_PROXY_HOPS` resolves (right-most `X-Forwarded-For` entry on Railway), so a caller cannot pick a new IP bucket by sending the header. The per-IP allowance is a count per window rather than one claim per day so that many people behind one IP (an event venue, a classroom) can be onboarded in one session. A log warning `faucet_low_balance` fires when the balance covers fewer than 20 claims.

### `GET /faucet/signet`

Faucet status: who can claim, and whether a claim can be paid right now.

```json
{ "enabled": true, "network": "signet", "access": "testnet_app_social_login",
  "message": "The Writz Signet faucet only funds accounts created through the Writz testnet app's social login, once per account. Builders: use a public Signet faucet.",
  "address": "tb1q...", "amountSats": 20000, "dailyCap": 300, "remainingToday": 297,
  "resetsAt": "2026-10-25T00:00:00.000Z", "funded": true, "publicFaucets": ["https://signetfaucet.com", "..."] }
```

`address` is the faucet wallet: send Signet coins there to refill it, and read its balance on a Signet explorer. `funded` is false when the balance does not cover one more claim and `null` when Esplora is unavailable. When the faucet is off the route answers `{ "enabled": false, "access": "testnet_app_social_login", "message": "...", "reason": "...", "publicFaucets": [...] }`.

#### Setting up the faucet

The key is a dedicated Signet hot wallet, separate from `PROTOCOL_SIGNING_KEY` (the relayer refuses to start the faucet with the protocol key, refuses `FAUCET_SIGNET_WIF` unless `BITCOIN_NETWORK=signet`, and the mainnet target refuses to boot with it set). Generate it straight into the deployment's secrets so it is never printed or written to disk:

```bash
cd relayer
railway variables --service writz --set "FAUCET_SIGNET_WIF=$(bun scripts/faucet-keygen.ts --wif-only)"
```

Claims also need the testnet app's Pollar credentials: `POLLAR_SECRET_KEY`, a `sec_testnet_` secret key created in the Pollar dashboard under **Build > API Keys** (shown once, at creation), and `POLLAR_APPLICATION_ID`, the app's id under **Settings > App ID**. Without both the faucet stays off; it never pays an address without a verified login. The relayer refuses to start with a `sec_mainnet_` key, and the mainnet target refuses `POLLAR_SECRET_KEY` altogether.

After the redeploy, `GET /faucet/signet` shows the address to fund. Signet blocks are signed, so coins cannot be mined: fund the address from the public Signet faucets (claimed by hand, never by a script that defeats their captchas) or by a transfer from another Signet wallet. `bun run faucet:keygen` prints a key and its address instead, for local development.

### `POST /cctp/relay`

Completes on Base Sepolia a USDC transfer a borrower burned on Stellar with Circle CCTP V2, so the borrower needs no wallet, gas or second signature there. The relay waits for Circle to sign the burn, then calls `receiveMessage` on Circle's MessageTransmitterV2 (`0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`, Base Sepolia) from its own account and pays the gas. The USDC is minted to the recipient named in the burn; the relay never holds it. Mounted only where lending is enabled (never on the mainnet target).

**Request body:** `{ "burnHash": "246bc8d7..." }`, the Stellar transaction hash of the `deposit_for_burn` (64 hex characters, any case).

The call returns at once with where the transfer stands (`202` while the relay works on it, `200` once it has arrived or failed) and the relay carries on in the background. Poll `GET /cctp/relay/:burnHash` for the rest. Asking again for the same burn never sends a second mint.

```json
{ "burnHash": "246bc8d7...", "kind": "sent", "createdAt": "2026-10-25T14:31:02.745Z", "updatedAt": "2026-10-25T14:31:02.745Z" }
```

| Status | `error` | Meaning |
|---|---|---|
| `400` | `invalid_burn_hash` | Not 64 hex characters |
| `429` | `rate_limited` | Too many requests from this IP (default 30 per 10 minutes) |
| `503` | `cctp_relay_disabled` | No relay key configured, or switched off with `CCTP_RELAY_ENABLED=false` |
| `503` | `relay_busy` | As many transfers in flight as `CCTP_RELAY_MAX_IN_FLIGHT` allows; `retryAfterSeconds` says when to retry |

### `GET /cctp/relay/:burnHash`

Where a transfer stands. `kind` takes the same values as the app's `CctpStatus`:

| `kind` | Meaning |
|---|---|
| `sent` | Recorded; Circle has not reported the burn yet |
| `confirming` | Circle has the burn and is waiting for Stellar finality |
| `confirmed` | Circle signed it; the relay is minting on Base Sepolia |
| `arrived` | Minted. `mintHash` and `explorerUrl` link the Base Sepolia transaction |
| `failed` | The relay stopped for good; `reason` says why |

While the relay is waiting out a transient failure, `kind` stays at the stage the transfer reached (`confirmed` once Circle has signed, `confirming` before) and three fields are added: `retrying: true`, `reason` (what it is waiting out) and `nextRetryAt` (when the next attempt is due). The app keeps polling; nothing needs to be sent again.

```json
{ "burnHash": "246bc8d7...", "kind": "confirmed", "retrying": true,
  "reason": "the relay is out of Base Sepolia gas; it retries once the account is refilled",
  "nextRetryAt": "2026-10-25T14:32:02.745Z", "recipient": "0xc766579fe25474e41f612dd345772a61325878d2",
  "amount": "10000000", "feeExecuted": "0", "createdAt": "2026-10-25T14:31:02.745Z", "updatedAt": "2026-10-25T14:31:32.745Z" }
```

```json
{ "burnHash": "246bc8d7...", "kind": "arrived", "mintHash": "0x5f1e...", "explorerUrl": "https://sepolia.basescan.org/tx/0x5f1e...",
  "recipient": "0xc766579fe25474e41f612dd345772a61325878d2", "amount": "10000000", "feeExecuted": "0", "mintedBy": "relay",
  "createdAt": "2026-10-25T14:31:02.745Z", "updatedAt": "2026-10-25T14:31:09.120Z" }
```

`amount` and `feeExecuted` are USDC base units (6 decimals). `mintedBy` is `other` when someone completed the transfer before the relay did; the USDC arrived either way. The relay then finds that transaction from its `MessageReceived` log: first through the RPC over the last `CCTP_RELAY_MINT_LOOKBACK_BLOCKS` blocks, then, if that misses it, through a public Base Sepolia indexer (`CCTP_RELAY_MINT_INDEXER_URL`, Blockscout by default, no key) over the whole chain. The indexer's answer is accepted only for a log emitted by MessageTransmitterV2 with the `MessageReceived` signature and the transfer's nonce. `mintHash` is `null` only if both sources fail; the relay searches again with backoff (up to 8 more times) and fills it in, so a later poll can return the hash. `404 not_found` means the relay was never asked about this burn.

Failures are transient or final:

| Failure | Class | What happens |
|---|---|---|
| Circle has not confirmed within `CCTP_RELAY_CONFIRM_TIMEOUT_MINUTES` | transient | Retried automatically |
| Base Sepolia unreachable (simulation, send, unexpected error) | transient | Retried automatically |
| Mint broadcast but not mined in time, or reverted | transient | Retried automatically; the retry checks the earlier broadcast first and simulates again before any new send |
| Gas account empty | transient | Retried once the account holds at least 0.0001 ETH; until then each due attempt only reads the balance |
| Daily cap (`CCTP_RELAY_DAILY_CAP`) | transient | Retried after 00:00 UTC |
| Not a Stellar to Base Sepolia USDC burn | final | Never relayed |
| MessageTransmitterV2 refuses the mint in simulation (invalid signature, expired message) | final | Never relayed |
| Circle never reports the burn within 10 minutes | final | Most likely not a CCTP transfer; a new `POST` starts over |
| Transient failures for 24 hours | final | The relay gives up; `reason` says what it was waiting on; a new `POST` starts over |

Automatic retries back off exponentially (30 seconds, doubling, at most 15 minutes apart). A sweep every 15 seconds runs those that are due, and a `GET` or `POST` for a burn whose retry is due runs it at once. Retries go through the same job, lock and checks as the first attempt, so they never send a second mint. Only final failures are reported as `failed`.

How it works:

- **Only the one route it exists for.** Before spending gas the relay decodes the signed message and refuses anything that is not a CCTP V2 USDC burn from Stellar (domain 27) to Base Sepolia (domain 6), addressed to Circle's TokenMessengerV2, with no destination caller, no hook and an EVM recipient. The relay key cannot be used to pay for other chains' transfers or other messages.
- **Never twice.** One job per burn; every mint from the relay key runs behind one lock and waits for its receipt before the next is built, which also keeps the account's EVM nonces in order. Inside the lock the relay re-reads the record, checks a mint it already broadcast before sending anything new, checks `usedNonces` on MessageTransmitterV2, and simulates `receiveMessage`. A nonce already spent, by the relay or anyone else, is reported as `arrived` with the transaction that spent it, found from the `MessageReceived` log. Minting twice is impossible on chain anyway: each nonce is received once; these checks keep the relay from paying for a mint that would revert.
- **Survives restarts.** Records live in `data/cctp-relay.db` (burn hash, state, nonce, recipient, amount, the signed message, the mint hash, the failure and its retry schedule, times). Transfers in flight resume at startup, and scheduled retries run when due. `lookupCctpRelay(store, burnHash)` in `src/cctp/store.ts` reads a record without driving it.
- **Bounded.** Circle is polled with backoff (3 s doubling to 30 s); a burn Circle has never reported is dropped after 10 minutes, one it has not confirmed is retried after `CCTP_RELAY_CONFIRM_TIMEOUT_MINUTES`, and any transfer still failing 24 hours after its first transient failure is given up. Mints are capped per UTC day (`CCTP_RELAY_DAILY_CAP`) and transfers in flight by `CCTP_RELAY_MAX_IN_FLIGHT`. A log warning `cctp_relay_low_balance` fires when the account holds less than 0.002 ETH, and `cctp_relay_out_of_gas` when it cannot pay.

### `GET /cctp/relay`

Relay status, for whoever keeps its account funded.

```json
{ "enabled": true, "network": "base-sepolia", "address": "0x53DB...", "balanceWei": "50000000000000000", "lowBalance": false,
  "messageTransmitter": "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275", "mintsToday": 3, "dailyCap": 200, "inFlight": 0 }
```

`address` is the relay's Base Sepolia account: send Base Sepolia ETH there to pay for mints. `balanceWei` is `null` when the RPC is unavailable. Without a key the route answers `{ "enabled": false, "network": "base-sepolia", "reason": "..." }`.

#### Setting up the relay key

The key is a dedicated Base Sepolia account that only pays gas. Generate it straight into the deployment's secrets, so the key is never printed or written to disk; the command prints only the address to fund:

```bash
cd relayer
railway variables --service writz --set "CCTP_RELAY_EVM_KEY=$(bun scripts/cctp-relay-keygen.ts --key-only)"
```

Fund that address with Base Sepolia ETH (a public Base Sepolia faucet, or a bridge from Sepolia); `receiveMessage` takes about 175,000 gas, around 0.000001 ETH at Base Sepolia's gas price in October 2026 plus the L1 data fee, so 0.01 ETH covers thousands of mints. After the redeploy, `GET /cctp/relay` shows the address and its balance. `bun run cctp-relay:keygen` prints a key and its address instead, for local development. The mainnet target refuses to boot with `CCTP_RELAY_EVM_KEY` set.

### `GET /health`

Returns `{"status":"ok",...}` - used by load balancers.

## Environment variables

Copy `.env.example` to `.env` and adjust as needed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port |
| `BITCOIN_NETWORK` | `mainnet` | `mainnet` or `signet` |
| `ESPLORA_URL` | mempool.space for the network | Override for a self-hosted node |
| `ESPLORA_FALLBACK_URL` | *(unset)* | Second Esplora base URL for `/spv-proof`, used when the primary answers 429/5xx or is unreachable. Must serve the same Esplora API for the same network, e.g. `https://blockstream.info/signet/api` |
| `ESPLORA_RETRIES` | `2` | Retries per Esplora host on 429, 5xx and network errors for `/spv-proof` (backoff 250 ms, then doubling) |
| `TRUST_PROXY_HOPS` | `1` | Reverse-proxy hops trusted for the client IP (Express `trust proxy`). `1` matches Railway's edge; `0` disables |
| `SPV_PROOF_RATE_LIMIT` | `60` | Requests per client IP per window on `/spv-proof` |
| `SPV_PROOF_RATE_WINDOW_MS` | `60000` | Rate-limit window for `/spv-proof` |
| `SPV_PROOF_CACHE_MAX_ENTRIES` | `1000` | Proof cache size; least recently used entries are evicted first |
| `SPV_PROOF_CACHE_TTL_MS` | `3600000` | Lifetime of a cached proof whose block is at least 6 deep |
| `DEPOSIT_STATUS_RATE_LIMIT` | `120` | Requests per client IP per window on `/deposit-status` |
| `DEPOSIT_STATUS_RATE_WINDOW_MS` | `60000` | Rate-limit window for `/deposit-status` |
| `TIMELINE_RATE_LIMIT` | `60` | Requests per client IP per window on `/timeline` |
| `TIMELINE_RATE_WINDOW_MS` | `60000` | Rate-limit window for `/timeline` |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | Horizon, read by `/timeline` for the borrower's swaps and burns |
| `SOROSWAP_ROUTER_ID` | testnet Soroswap router | Router a borrow is swapped to XLM through, matched by `/timeline` |
| `CCTP_TOKEN_MESSENGER_MINTER_ID` | testnet CCTP V2 TokenMessengerMinter | Contract a borrow is burned through for Base Sepolia, matched by `/timeline` |
| `CORS_ORIGIN` | `*` | Allowed origin(s) - comma-separated or `*` |
| `DEFAULT_CONFIRMATIONS` | `6` | Used when caller omits the query param |
| `MAX_CONFIRMATIONS` | `20` | Hard cap on the confirmations param |
| `REQUEST_TIMEOUT_MS` | `10000` | Esplora request timeout in ms |
| `FAUCET_SIGNET_WIF` | *(unset)* | WIF of the Signet faucet's hot wallet. Unset: `/faucet/signet` answers `503 faucet_disabled`. Signet only, never the protocol key |
| `POLLAR_SECRET_KEY` | *(unset)* | Pollar Server API secret key of the testnet app (`sec_testnet_...`), used to verify the social login behind each faucet claim. Unset: the faucet answers `503 faucet_disabled`. Refused on the mainnet target |
| `POLLAR_APPLICATION_ID` | *(unset)* | The testnet app's id in Pollar; a claim's login must belong to it. Unset: the faucet answers `503 faucet_disabled` |
| `POLLAR_API_URL` | `https://server.api.pollar.xyz/v3` | Pollar Server API base URL |
| `FAUCET_ALLOW_EMAIL` | `false` | `true` lets email one-time-code logins claim, not only Google and GitHub |
| `FAUCET_ENABLED` | `true` | `false` switches the faucet off without removing the key |
| `FAUCET_AMOUNT_SATS` | `20000` | Sats per claim; must be between 1,000 and 50,000 |
| `FAUCET_DAILY_CAP` | `300` | Claims per UTC day across all callers |
| `FAUCET_IP_CLAIMS_PER_WINDOW` | `20` | Claims per client IP within `FAUCET_IP_WINDOW_HOURS` (sliding window) |
| `FAUCET_IP_WINDOW_HOURS` | `1` | Window for `FAUCET_IP_CLAIMS_PER_WINDOW` |
| `FAUCET_MIN_FEE_RATE` | `2` | Fee floor, sat/vbyte |
| `FAUCET_MAX_FEE_RATE` | `25` | Fee ceiling, sat/vbyte |
| `FAUCET_FEE_TARGET_BLOCKS` | `3` | Esplora fee-estimate target |
| `FAUCET_RATE_LIMIT` | `30` | Claim attempts per client IP per window, successful or not (nonce requests have their own budget of the same size) |
| `FAUCET_RATE_WINDOW_MS` | `600000` | Window for `FAUCET_RATE_LIMIT` |
| `FAUCET_SQLITE_PATH` | `data/faucet.db` | Claim records (one claim per account and address, per-IP allowance, daily count) |
| `CCTP_RELAY_EVM_KEY` | *(unset)* | 0x-prefixed hex private key of the CCTP relay's Base Sepolia account. Unset: `/cctp/relay` answers `503 cctp_relay_disabled`. Testnet only, gas only |
| `CCTP_RELAY_ENABLED` | `true` | `false` switches the relay off without removing the key |
| `CCTP_RELAY_RPC_URL` | `https://sepolia.base.org` | Base Sepolia RPC; checked to serve chain 84532 before the first mint |
| `CCTP_IRIS_URL` | `https://iris-api-sandbox.circle.com` | Circle's Iris API (sandbox: testnets) |
| `CCTP_RELAY_CONFIRM_TIMEOUT_MINUTES` | `30` | How long the relay waits for Circle to confirm a burn before it reports `failed` |
| `CCTP_RELAY_DAILY_CAP` | `200` | Mints the relay broadcasts per UTC day |
| `CCTP_RELAY_MAX_IN_FLIGHT` | `50` | Transfers in progress at once; beyond it `POST` answers `503 relay_busy` |
| `CCTP_RELAY_MINT_LOOKBACK_BLOCKS` | `10000` | How far back (about 5.5 hours) the relay looks through the RPC for a mint someone else sent |
| `CCTP_RELAY_MINT_INDEXER_URL` | `https://base-sepolia.blockscout.com/api` | Etherscan-compatible indexer asked for that mint when the RPC search misses it; empty: RPC only |
| `CCTP_RELAY_RATE_LIMIT` | `30` | POST attempts per client IP per window |
| `CCTP_RELAY_RATE_WINDOW_MS` | `600000` | Window for `CCTP_RELAY_RATE_LIMIT` |
| `CCTP_RELAY_SQLITE_PATH` | `data/cctp-relay.db` | Relay records (each burn, its state and its mint) |
| `DEFINDEX_API_KEY` | *(none)* | DeFindex API key (`sk_...`) from console.defindex.io |
| `DEFINDEX_API_URL` | `https://api.defindex.io` | DeFindex API base URL |
| `DEFINDEX_VAULT_ID` | *(none)* | Writz's own DeFindex vault contract ID - see `contracts/deployments/defindex-vault-testnet.md` |
| `VAULT_WATCHER_POLL_INTERVAL_MS` | `30000` | How often the vault watcher polls for deposit/withdraw events |
| `EARN_E2E_SIGNER_SECRET` | *(none)* | Testnet `S...` key signing the Earn e2e cycle - see below |
| `EARN_E2E_AMOUNT_STROOPS` | `1000000` | Amount the Earn e2e cycle deposits then withdraws (0.1 USDC) |
| `EARN_E2E_REQUIRED` | *(unset)* | `1` makes the Earn e2e suite fail rather than skip when unconfigured |

## Running locally

```bash
cp .env.example .env
# edit .env - set BITCOIN_NETWORK=signet for development
bun install
bun run dev       # tsx watch (hot reload)
# or
bun run build && bun start
```

Test with a known signet txid:

```bash
curl http://localhost:3000/spv-proof/<txid>?confirmations=1
curl http://localhost:3000/health
```

## Testing

```bash
bun run test
```

Most of the suite is fast and deterministic - it mocks any external service
(Esplora, `@defindex/sdk`, etc.), so it runs the same everywhere with no
credentials required.

`test/defindex.integration.test.ts` is the one exception: it makes no mocks
and calls the real DeFindex API against the real deployed testnet vault (see
`contracts/deployments/defindex-vault-testnet.md` for its address) to prove
the reads
(`/apy`, `/position`) and both tx-building routes (`/deposit`, `/withdraw`,
including a real over-withdrawal rejection) actually work end to end, not
just that the Express layer is wired correctly. It requires
`DEFINDEX_API_KEY` and `DEFINDEX_VAULT_ID` to be set (e.g. a local `.env`);
if either is missing - as in CI today - every test in that file logs a
warning and passes trivially instead of failing, so `bun run test` stays
fast and network-independent unless you deliberately configure real
credentials.

### The Earn end-to-end cycle

`test/earn-cycle.e2e.test.ts` goes one step further than any other suite: it
**submits** transactions. The integration tests above prove the relayer builds
a well-formed envelope, but a well-formed envelope the network rejects still
passes them. The cycle test signs the built transaction with a test keypair,
submits it to Soroban RPC, polls it to `SUCCESS`, and then checks the position
the vault actually reports - deposit, balance and APY read back, withdraw.

It walks the same three-party split the browser does (`frontend/src/lib/flows/earn.ts`),
with a keypair standing in for the connected wallet. The relayer still never
signs anything; it only builds.

```bash
# Needs DEFINDEX_API_KEY, DEFINDEX_VAULT_ID and EARN_E2E_SIGNER_SECRET.
bun run test:e2e
```

The signer must be a **throwaway testnet account** holding XLM for fees and a
balance of the vault's underlying asset. Every run really spends
`EARN_E2E_AMOUNT_STROOPS` (0.1 USDC by default) and withdraws most of it back.

Unconfigured, it warns and returns like the integration suite, so `bun run test`
stays green anywhere and CI is unaffected. The cost of that default is that a
run which was *meant* to exercise the cycle can pass by silently skipping, so
`EARN_E2E_REQUIRED=1` turns missing configuration into a failure:

```bash
EARN_E2E_REQUIRED=1 bun run test:e2e
```

This suite is not wired into CI. It submits real transactions and spends a real
testnet balance, and it needs credentials that CI does not hold - so it is run
deliberately, by a person, not on every push.

## Docker

Build from the **repo root** (the image needs `privacy/packages/commitment-tree/`
and `bitcoin-script/`, which live outside `relayer/`):

```bash
docker build -f Dockerfile -t writz-relayer .
docker run --rm -p 3000:3000 \
  -e BITCOIN_NETWORK=signet \
  -e CORS_ORIGIN=https://writz.xyz \
  writz-relayer
```

Or with an env file:

```bash
docker run --rm -p 3000:3000 --env-file .env writz-relayer
```

## Deployment

The container listens on `PORT` (default `3000`). Set `CORS_ORIGIN` to your frontend URL in production:

```
CORS_ORIGIN=https://writz.xyz
```

For a public demo on signet:

```
BITCOIN_NETWORK=signet
CORS_ORIGIN=https://your-frontend.vercel.app
```

---

## Deployed Relayer Instance

The Writz SPV Proof Relayer is deployed on Railway for the **Bitcoin signet** network:
- **Base URL:** `https://api.testnet.writz.xyz`

  A domain this project controls, deliberately, rather than the hosting
  provider's own hostname. The origin is compiled into the frontend bundle at
  build time via `NEXT_PUBLIC_RELAYER_URL`, so a provider migration behind a
  provider-issued hostname would mean editing this repo and rebuilding the
  frontend; behind this one it is a DNS change. The subdomain is scoped to the
  deploy target for the same reason `WRITZ_ENV` exists: a mainnet relayer gets
  its own host and cannot inherit this one by omission.
- **Health Check Endpoint:** `https://api.testnet.writz.xyz/health`

### Connecting to the Relayer

To verify a Bitcoin transaction and submit the SPV proof to the Soroban contract, follow these steps in your frontend or client application:

#### 1. Fetch the SPV Proof from the Relayer

Send a `GET` request to the relayer with the transaction ID (`txid`) and the desired number of confirmations.

```typescript
const txid = "a107055a66ed43c7a0dfae05c061c88bb07e91d589db43e78de017deb409254f"; // your signet txid
const confirmations = 6;

const response = await fetch(`https://api.testnet.writz.xyz/spv-proof/${txid}?confirmations=${confirmations}`);

if (!response.ok) {
  const errorData = await response.json();
  console.error("Failed to fetch proof:", errorData.message);
  return;
}

const proofBundle = await response.json();
const { sorobanArgs } = proofBundle;
```

#### 2. Submit the SPV Proof to the Soroban Contract

Using the `@stellar/stellar-sdk`, format the values from `sorobanArgs` into Stellar/Soroban SCVals and submit them to your contract call (like the `deposit` function on the `CommitmentTree` contract or `verify_transaction` on the `BitcoinSPV` contract):

```typescript
import { Contract, xdr, Address, nativeToScVal } from "@stellar/stellar-sdk";

// Initialize contract instance
const contractId = "CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM";
const commitmentTreeContract = new Contract(contractId);

// Format the arguments retrieved from the relayer
const headersScVal = xdr.ScVal.scvVec(
  sorobanArgs.headers.map((h: string) => xdr.ScVal.scvBytes(Buffer.from(h, "hex")))
);
const merkleProofScVal = xdr.ScVal.scvVec(
  sorobanArgs.merkle_proof.map((p: string) => xdr.ScVal.scvBytes(Buffer.from(p, "hex")))
);
const txIndexScVal = nativeToScVal(sorobanArgs.tx_index, { type: "u32" });
const rawTxScVal = xdr.ScVal.scvBytes(Buffer.from(sorobanArgs.raw_tx, "hex"));

// Prepare other parameters needed for Writz deposit (ZK Proof and Public Signals)
const zkProofScVal = ...; // Your generated ZK Proof ScVal
const publicSignalsScVal = ...; // Your public signals ScVal
const depositorScVal = nativeToScVal(Address.fromString(depositorAddress));

// Call the deposit function
const tx = await commitmentTreeContract.call(
  "deposit",
  depositorScVal,
  headersScVal,
  merkleProofScVal,
  txIndexScVal,
  rawTxScVal,
  zkProofScVal,
  publicSignalsScVal
);

// Sign and submit transaction to Soroban network...
```

