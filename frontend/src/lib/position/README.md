# Position & secret management

Client-side "wallet of positions" for Writz. Positions are private: the chain
only stores a `commitment` and `nullifier`; the amounts, `secret`, and `nonce`
live only here, on the user's device. Losing them locks the position until the
Bitcoin CLTV timelock — hence export/import.

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

- `createDepositPosition({ owner, collateralSats, txid?, createdAt })` — new
  position with fresh secret/nonce and derived commitment/nullifier.
- `positionWitness(position)` — the private fields fed to the ZK prover.

## Used by

Deposit (#7) creates a position here; borrow (#8) / repay (#9) read the witness
to prove; the dashboard (#10) reads it to compute the health factor locally.
