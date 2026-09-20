/**
 * The vault watcher anchors its first-ever poll to the current ledger tip
 * (see `poller.ts`), so every event that predates that first run is absent
 * from `vault_events` - and #115's TVL, computed from those rows, reads low
 * by exactly the missing amount. On testnet that gap is the vault's own
 * 20 USDC creation deposit, which `/metrics` then reports as accrued yield
 * (the metrics page derives yield as on-chain balance minus indexed
 * deposits). Those events have since aged out of Soroban RPC's retention
 * window, so re-polling cannot recover them; they are seeded from values
 * verified against Horizon instead.
 *
 * Same temp-path setup as vault-watcher.test.ts: point the event store at a
 * throwaway file *before* importing it, so this suite never touches a real
 * data/vault-events.db.
 */
import fs from "fs";
import os from "os";
import path from "path";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vault-genesis-test-"));
process.env.VAULT_EVENTS_SQLITE_PATH = path.join(TMP_DIR, "vault-events.db");

import {
  GENESIS_VAULT_EVENTS,
  GENESIS_VAULT_ID,
  seedGenesisVaultEvents,
} from "../src/vault-watcher/genesis-events.js";
import { readAllVaultEvents, type VaultEvent } from "../src/vault-watcher/event-store.js";

describe("GENESIS_VAULT_EVENTS", () => {
  test("carries the vault's creation deposit, as verified on Horizon", () => {
    expect(GENESIS_VAULT_EVENTS).toEqual<VaultEvent[]>([
      {
        cursor: "backfill:horizon:tx-e80b9bab14",
        kind: "deposit",
        depositor: "GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT",
        amountStroops: "200000000",
        ledger: 4473923,
        txHash: "e80b9bab145824fab252846b1c95da9d57cfb93cbdeab7ae7a91d4105450bf61",
        ledgerCloseTime: 1788393202,
      },
    ]);
  });
});

describe("seedGenesisVaultEvents", () => {
  test("persists the genesis events for the vault they belong to", () => {
    const persisted: VaultEvent[] = [];

    const seeded = seedGenesisVaultEvents(GENESIS_VAULT_ID, (e) => persisted.push(e));

    expect(seeded).toBe(1);
    expect(persisted).toEqual(GENESIS_VAULT_EVENTS);
  });

  test("seeds nothing when the relayer is pointed at a different vault", () => {
    const persisted: VaultEvent[] = [];

    const seeded = seedGenesisVaultEvents(
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      (e) => persisted.push(e),
    );

    expect(seeded).toBe(0);
    expect(persisted).toEqual([]);
  });

  test("a second run does not double-count against the real event store", () => {
    seedGenesisVaultEvents(GENESIS_VAULT_ID);
    seedGenesisVaultEvents(GENESIS_VAULT_ID);

    const genesisRows = readAllVaultEvents().filter(
      (r) => r.txHash === GENESIS_VAULT_EVENTS[0].txHash,
    );
    expect(genesisRows).toHaveLength(1);
  });
});
