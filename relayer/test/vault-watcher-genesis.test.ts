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

/** Ledger and close time of the oldest event the watcher ever polled itself
 * (2026-09-08). Everything seeded must be strictly older than this. */
const FIRST_POLLED_LEDGER = 4575790;
const FIRST_POLLED_CLOSE_TIME = 1788902537;

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

describe("GENESIS_VAULT_EVENTS", () => {
  // The values are transcribed by hand from Horizon, so assert their shape
  // rather than only their equality to themselves: a typo in an address or a
  // 6-vs-7-decimal slip would otherwise sail through both this suite and
  // review, and land as a phantom depositor or a 10x TVL error.
  test.each(GENESIS_VAULT_EVENTS.map((e, i) => [i, e] as const))(
    "entry %i is structurally a plausible vault event",
    (_i, event) => {
      expect(event.depositor).toMatch(/^G[A-Z2-7]{55}$/);
      expect(event.txHash).toMatch(/^[0-9a-f]{64}$/);
      expect(BigInt(event.amountStroops)).toBeGreaterThan(0n);
      expect(event.ledger).toBeGreaterThan(0);
      // Must predate the watcher's first indexed event - anything at or after
      // it would have been polled normally and does not belong here.
      expect(event.ledger).toBeLessThan(FIRST_POLLED_LEDGER);
      expect(event.ledgerCloseTime).toBeLessThan(FIRST_POLLED_CLOSE_TIME);
    },
  );

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

    const seeded = seedGenesisVaultEvents(GENESIS_VAULT_ID, TESTNET_PASSPHRASE, (e) =>
      persisted.push(e),
    );

    expect(seeded).toBe(1);
    expect(persisted).toEqual(GENESIS_VAULT_EVENTS);
  });

  test("seeds nothing when the relayer is pointed at a different vault", () => {
    const persisted: VaultEvent[] = [];

    const seeded = seedGenesisVaultEvents(
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      TESTNET_PASSPHRASE,
      (e) => persisted.push(e),
    );

    expect(seeded).toBe(0);
    expect(persisted).toEqual([]);
  });

  // The realistic mainnet accident is a copied service (see deploy-target.ts):
  // nine of twelve variables get corrected and DEFINDEX_VAULT_ID is left
  // pointing at testnet's vault. The vault id alone therefore cannot protect
  // mainnet - these are testnet events and only testnet may receive them.
  test("refuses to seed testnet history into a mainnet relayer", () => {
    const persisted: VaultEvent[] = [];

    const seeded = seedGenesisVaultEvents(GENESIS_VAULT_ID, MAINNET_PASSPHRASE, (e) =>
      persisted.push(e),
    );

    expect(seeded).toBe(0);
    expect(persisted).toEqual([]);
  });

  // config.ts reads DEFINDEX_VAULT_ID without trimming while deploy-target.ts
  // validates it trimmed, so a value pasted into a dashboard with a trailing
  // newline boots clean and would silently skip the backfill.
  test("tolerates surrounding whitespace on the configured vault id", () => {
    const persisted: VaultEvent[] = [];

    const seeded = seedGenesisVaultEvents(` ${GENESIS_VAULT_ID}\n`, ` ${TESTNET_PASSPHRASE} `, (e) =>
      persisted.push(e),
    );

    expect(seeded).toBe(1);
    expect(persisted).toEqual(GENESIS_VAULT_EVENTS);
  });

  // index.ts calls startVaultWatcher() unguarded at module scope, and its own
  // comment promises the watcher "never blocks the HTTP API from starting".
  // A full or read-only /app/data volume must not take the SPV proof service
  // down with it.
  test("a failing store degrades to zero seeded instead of throwing", () => {
    const boom = () => {
      throw new Error("SQLITE_FULL: database or disk is full");
    };

    expect(() => seedGenesisVaultEvents(GENESIS_VAULT_ID, TESTNET_PASSPHRASE, boom)).not.toThrow();
    expect(seedGenesisVaultEvents(GENESIS_VAULT_ID, TESTNET_PASSPHRASE, boom)).toBe(0);
  });

  test("a second run does not double-count against the real event store", () => {
    seedGenesisVaultEvents(GENESIS_VAULT_ID, TESTNET_PASSPHRASE);
    seedGenesisVaultEvents(GENESIS_VAULT_ID, TESTNET_PASSPHRASE);

    const genesisRows = readAllVaultEvents().filter(
      (r) => r.txHash === GENESIS_VAULT_EVENTS[0].txHash,
    );
    expect(genesisRows).toHaveLength(1);
  });
});
