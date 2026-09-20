/**
 * Vault events that predate the watcher's first poll, replayed into the
 * event store at startup.
 *
 * `runVaultPollCycle` anchors its first-ever run to the current ledger tip
 * rather than backfilling history (see the comment in `poller.ts`), so any
 * event older than that first run never reaches `vault_events`. #115's TVL
 * and #116's cohorts are computed from those rows, so the gap surfaces as an
 * understated "Net Indexed Deposits" - and, because the metrics page derives
 * accrued yield as `onChainTvl - indexedTvl`, the missing deposits are
 * published as if they were yield.
 *
 * `poller.ts` documents the normal recovery for a gap: rewind the cursor and
 * re-poll, which is safe because `insertVaultEvent` is idempotent. That does
 * not work here. Soroban RPC only retains events for a window on the order
 * of days (the same retention that strands a stale cursor - see
 * `rpc-cursor.ts`), and these ledgers are long past it; `getEvents` cannot
 * return them at any cursor. So they are seeded from constants instead.
 *
 * Every field below was read from Horizon, which keeps full transaction
 * history, rather than copied from a deployment note:
 *
 *   curl https://horizon-testnet.stellar.org/transactions/<txHash>
 *   curl https://horizon-testnet.stellar.org/transactions/<txHash>/operations
 *
 * The transaction resource gives `ledger` and `created_at` (the close time,
 * as Unix seconds); the operation's `asset_balance_changes` gives the
 * transfer's `from` (the depositor), `to` (the vault, which is what
 * identifies the change as this vault's) and `amount` in USDC, converted
 * here to 7-decimal stroops. Horizon no longer returns `result_meta_xdr`,
 * so the contract event itself cannot be decoded from it - the balance
 * change is the authoritative record available. Re-verify against those two
 * endpoints before changing any value here.
 */
import { TESTNET_PASSPHRASE } from "../deploy-target.js";
import { insertVaultEvent, type VaultEvent } from "./event-store.js";

/**
 * The vault these events belong to: the testnet Writz USDC vault recorded in
 * `contracts/deployments/defindex-vault-testnet.md`.
 *
 * This is necessary but not sufficient as a guard. `deploy-target.ts` exists
 * because the realistic deployment accident is a *copy* - cloning the testnet
 * service and correcting most, not all, of its variables - and a clone that
 * keeps `DEFINDEX_VAULT_ID` would pass a vault-id-only check while running on
 * mainnet. `findTargetConflicts` requires that variable to be set but never
 * requires it to differ from testnet's, so seeding checks the network
 * passphrase as well: these are testnet events and only a testnet relayer may
 * receive them.
 */
export const GENESIS_VAULT_ID = "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S";

/**
 * The vault's creation deposit: 20 USDC moved in the same transaction that
 * deployed the vault through the DeFindex factory
 * (`create_defindex_vault_deposit`, via `scripts/deploy/deploy_defindex_vault.mjs`)
 * on 2026-09-02, six days before the watcher's first run on 2026-09-08.
 *
 * `cursor` names the backfill rather than impersonating an RPC cursor: the
 * column exists to make a row's provenance self-contained, and claiming a
 * cursor position this row was never read at would defeat that.
 */
export const GENESIS_VAULT_EVENTS: VaultEvent[] = [
  {
    cursor: "backfill:horizon:tx-e80b9bab14",
    kind: "deposit",
    depositor: "GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT",
    amountStroops: "200000000",
    ledger: 4473923,
    txHash: "e80b9bab145824fab252846b1c95da9d57cfb93cbdeab7ae7a91d4105450bf61",
    ledgerCloseTime: 1788393202,
  },
];

/**
 * Replays the genesis events into the event store, returning how many were
 * written without error. Safe to call on every boot: `insertVaultEvent` is
 * idempotent on (tx_hash, depositor, kind, amount), so a relayer that has
 * already seeded them - or that polled them itself before they aged out - is
 * unaffected.
 *
 * Both identifiers are trimmed before comparison. `config.ts` reads
 * `DEFINDEX_VAULT_ID` raw while `deploy-target.ts` validates it trimmed, so a
 * value pasted into a hosting dashboard with a trailing newline boots clean
 * and would otherwise skip the backfill for an invisible reason.
 *
 * A store failure is contained rather than propagated. `index.ts` calls
 * `startVaultWatcher()` unguarded at module scope, promising in its own
 * comment that the watcher "never blocks the HTTP API from starting"; letting
 * a full or read-only data volume throw from here would take the SPV proof
 * endpoints down with the metrics backfill, turning a reporting gap into an
 * outage. Degrading matches `runVaultPollCycle`, which logs a failed persist
 * and carries on.
 */
export function seedGenesisVaultEvents(
  vaultId: string,
  networkPassphrase: string,
  persist: (event: VaultEvent) => void = insertVaultEvent,
): number {
  if (vaultId.trim() !== GENESIS_VAULT_ID) return 0;
  if (networkPassphrase.trim() !== TESTNET_PASSPHRASE) return 0;

  let seeded = 0;
  for (const event of GENESIS_VAULT_EVENTS) {
    try {
      persist(event);
      seeded++;
    } catch (e) {
      console.error(
        `[vault-watcher] genesis backfill: failed to persist ${event.kind} ${event.txHash.slice(0, 10)}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return seeded;
}
