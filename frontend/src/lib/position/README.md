# Position & secret management

Client-side "wallet of positions" for Writz. Positions are private: the chain
only stores a `commitment` and `nullifier`; the amounts live in an on-chain
encrypted recovery note, and `secret`/`nonce` are derived on demand from a
deterministic signature of the owner's Stellar wallet (issue #18) - nothing
sensitive is persisted locally. `exportPositions`/`importPositions` below
predate #18 and have no UI caller anymore; `recoverPositions` (see
`lib/flows/recover.ts`) is the live recovery path, wired to the "Recover
positions" button in `PositionDashboard`. The one thing recovery does *not*
restore is Bitcoin release metadata (`btcPubkey`/`timelockHeight`/`vout`) -
see the caveat in `docs/products/privatelend.md` Step 5.

## Crypto (`crypto.ts`)

Matches the circuits in `circuits/src/` exactly (verified equal to the
`circomlibjs` Poseidon used there):

- `commitment = Poseidon(collateral_satoshis, debt_stroops, secret, nonce)`
- `nullifier  = Poseidon(secret, nonce)`

`randomFieldElement()` produces a CSPRNG value in the BN254 field.

## Data model (`types.ts`)

`Position` holds `owner`, `txid`, `collateralSats`, `debtStroops`, `secret`,
`nonce`, `commitment`, `nullifier`, `status`, `createdAt`. BigInts are stored as
decimal strings for JSON-safe persistence.

## Storage (`store.ts`)

`localStorage`, keyed per owner address: **`writz.positions.<address>`**.
CRUD: `listPositions`, `getPosition`, `savePosition`, `removePosition`.
Backup: `exportPositions` / `importPositions` (versioned envelope).

## Helpers (`index.ts`)

- `createDepositPosition({ owner, collateralSats, txid?, createdAt })` - new
  position with fresh secret/nonce and derived commitment/nullifier.
- `positionWitness(position)` - the private fields fed to the ZK prover.

## Used by

Deposit (#7) creates a position here; borrow (#8) / repay (#9) read the witness
to prove; the dashboard (#10) reads it to compute the health factor locally.
