/**
 * bun run rebuild-lend-state [--dry-run] [--source archive --file <path-or-url>]
 *
 * Rebuilds the event archive and the repay watcher's cursor from the chain,
 * and queues every release still owed. Needs public RPC access only, plus an
 * archive file (`bun run export-lend-events`) once the deployment ledger is
 * past RPC retention.
 *
 *   WRITZ_LEND_ID             the contract
 *   WRITZ_LEND_DEPLOY_LEDGER  where the replay starts, from RPC only
 *   STELLAR_RPC_URL           defaults to the testnet RPC
 *   STELLAR_NETWORK_PASSPHRASE        defaults to testnet
 *
 * It refuses to run while a relayer uses the same data directory.
 */
import fs from "fs";
import path from "path";
import { Networks, rpc } from "@stellar/stellar-sdk";
import { Client as WritzLendClient } from "writz-lend";
import { assertDataDirFree } from "../data-lock.js";
import { ArchiveRejected, parseArchive } from "../lend-events/archive-file.js";
import { decodeLendEvent } from "../lend-events/decode.js";
import type { LendEventsCycleDeps } from "../lend-events/poller.js";
import { lendEventsDbPath } from "../lend-events/store.js";
import { openReleaseStore, watcherDbPath } from "../repay-watcher/release-store.js";
import { RebuildMismatch, rebuildLendState, type ArchiveSource, type RebuildServer } from "./rebuild.js";
import type { LendChainReader } from "./verify.js";

const READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function chainReader(client: WritzLendClient): LendChainReader {
  const txid = (hex: string) => Buffer.from(hex, "hex");
  return {
    positionStatus: async (hex) => (await client.get_position({ txid: txid(hex) })).result?.status.tag ?? null,
    scaledSupply: async (lender) => (await client.get_supply_position({ lender })).result.scaled,
    totalScaledSupply: async () => (await client.get_protocol_state()).result.total_scaled_supply,
    hasRelease: async (hex) => Boolean((await client.get_release_psbt({ txid: txid(hex) })).result),
  };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

/** A local path, or an http(s) URL such as another relayer's /lend-events/export. */
async function readArchiveText(source: string): Promise<string> {
  if (!/^https?:\/\//.test(source)) return fs.readFileSync(source, "utf8");
  const res = await fetch(source);
  if (!res.ok) throw new Error(`${source} answered ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const sourceKind = flag("--source") ?? "rpc";
  if (sourceKind !== "rpc" && sourceKind !== "archive") throw new Error("--source is rpc or archive");
  const file = flag("--file");
  if ((sourceKind === "archive") !== Boolean(file)) throw new Error("--source archive needs --file, and --file needs --source archive");
  const contractId = required("WRITZ_LEND_ID");
  // Only the RPC replay starts from it; an archive carries its own starting point.
  const deployLedger = sourceKind === "rpc" ? Number(required("WRITZ_LEND_DEPLOY_LEDGER")) : 0;
  if (sourceKind === "rpc" && (!Number.isInteger(deployLedger) || deployLedger <= 0)) {
    throw new Error("WRITZ_LEND_DEPLOY_LEDGER must be a ledger sequence");
  }
  const rpcUrl = process.env["STELLAR_RPC_URL"] ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase = process.env["STELLAR_NETWORK_PASSPHRASE"] ?? Networks.TESTNET;

  let archive: ArchiveSource | undefined;
  if (file) {
    const { header, rows } = parseArchive(await readArchiveText(file), { contractId, networkPassphrase });
    archive = { rows, cursor: header.cursor };
    console.log(`Archive file:         ${rows.length} events, ledgers ${header.firstLedger ?? "-"} to ${header.lastLedger ?? "-"}`);
  }
  const archivePath = lendEventsDbPath();
  const watcherPath = watcherDbPath();

  assertDataDirFree(path.dirname(archivePath));
  assertDataDirFree(path.dirname(watcherPath));

  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  const client = new WritzLendClient({
    contractId, networkPassphrase, rpcUrl, allowHttp: rpcUrl.startsWith("http://"), publicKey: READ_ONLY_SOURCE,
  });
  const rebuildServer = server as unknown as RebuildServer;
  rebuildServer.ledgerRange = async () => {
    const { oldestLedger, latestLedger } = await server.getHealth();
    return { oldest: oldestLedger, latest: latestLedger };
  };

  const report = await rebuildLendState({
    server: rebuildServer,
    chain: chainReader(client),
    contractId,
    deployLedger,
    archivePath,
    openReleases: () => openReleaseStore(watcherPath),
    decodeEvent: decodeLendEvent as LendEventsCycleDeps["decodeEvent"],
    ...(archive ? { archive } : {}),
    dryRun,
  });

  console.log(`Events replayed:      ${report.events}`);
  console.log(`Positions verified:   ${report.positions}`);
  console.log(`Suppliers verified:   ${report.suppliers}`);
  console.log(`Total scaled supply:  ${report.totalScaled}`);
  console.log(`Repaid in full:       ${report.repaidInFull}`);
  console.log(`Missing releases:     ${report.missingReleases.length}`);
  for (const txid of report.missingReleases) console.log(`  ${txid}`);
  console.log(report.swapped ? "Verified against the chain and swapped in." : "Verified against the chain. Dry run: nothing changed.");
}

main().catch((e: unknown) => {
  const label =
    e instanceof RebuildMismatch ? "Mismatch with the chain, nothing changed"
    : e instanceof ArchiveRejected ? "Archive file rejected, nothing changed"
    : "Failed";
  console.error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
