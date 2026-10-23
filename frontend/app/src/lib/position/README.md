# Positions on this device

`writz-lend` keeps every loan in plaintext on Stellar, keyed by its Bitcoin
deposit txid: amounts, debt, depositor, the Bitcoin key and the timelock are
all public on chain. Nothing secret lives on this device, and there is no
signature to unlock.

## Data model (`types.ts`)

`Position` is a cache of what the chain says plus what it does not answer
directly: the loan's number for this wallet (`index`), the deposit output
index (`vout`) and the release this device sent. `id` is the deposit txid in
display order. Status on screen never comes from this record alone; it is
derived from `get_position` (see `lib/status`).

## Storage (`store.ts`)

`localStorage`, keyed per owner address: **`writz.positions.<address>`**.
CRUD: `listPositions`, `getPosition`, `savePosition`, `removePosition`.
Backup: `exportPositions` / `importPositions` (versioned envelope).

## Finding positions

`writz-lend` has no owner index. `lib/flows/discover.ts` rebuilds the list
from the chain: it reads the wallet's own `deposit` calls to `writz-lend`
from Horizon's operation history, hashes each call's raw Bitcoin
transaction into the deposit txid, and confirms each one with `get_position`
(the depositor must be this wallet). Positions already on this device are
refreshed the same way.
