/**
 * bun run rebuild-lend-state [--dry-run]
 *
 * Rebuilds the event archive and the repay watcher's cursor from the chain,
 * and queues every release still owed. Needs public RPC access only.
 *
 *   WRITZ_LEND_ID             the contract
 *   WRITZ_LEND_DEPLOY_LEDGER  where the replay starts
 *   STELLAR_RPC_URL           defaults to the testnet RPC
 *   STELLAR_NETWORK_PASSPHRASE        defaults to testnet
 *
 * It refuses to run while a relayer uses the same data directory.
 */
import path from "path";
import { Networks, rpc } from "@stellar/stellar-sdk";
import { Client as WritzLendClient } from "writz-lend";
import { assertDataDirFree } from "../data-lock.js";
import { decodeLendEvent } from "../lend-events/decode.js";
import type { LendEventsCycleDeps } from "../lend-events/poller.js";
import { lendEventsDbPath } from "../lend-events/store.js";
import { openReleaseStore, watcherDbPath } from "../repay-watcher/release-store.js";
import { RebuildMismatch, rebuildLendState, type RebuildServer } from "./rebuild.js";
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

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const contractId = required("WRITZ_LEND_ID");
  const deployLedger = Number(required("WRITZ_LEND_DEPLOY_LEDGER"));
  if (!Number.isInteger(deployLedger) || deployLedger <= 0) throw new Error("WRITZ_LEND_DEPLOY_LEDGER must be a ledger sequence");
  const rpcUrl = process.env["STELLAR_RPC_URL"] ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase = process.env["STELLAR_NETWORK_PASSPHRASE"] ?? Networks.TESTNET;
  const archivePath = lendEventsDbPath();
  const watcherPath = watcherDbPath();

  assertDataDirFree(path.dirname(archivePath));
  assertDataDirFree(path.dirname(watcherPath));

  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  const client = new WritzLendClient({
    contractId, networkPassphrase, rpcUrl, allowHttp: rpcUrl.startsWith("http://"), publicKey: READ_ONLY_SOURCE,
  });
  const rebuildServer = server as unknown as RebuildServer;
  rebuildServer.oldestLedger = async () => (await server.getHealth()).oldestLedger;

  const report = await rebuildLendState({
    server: rebuildServer,
    chain: chainReader(client),
    contractId,
    deployLedger,
    archivePath,
    openReleases: () => openReleaseStore(watcherPath),
    decodeEvent: decodeLendEvent as LendEventsCycleDeps["decodeEvent"],
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
  const label = e instanceof RebuildMismatch ? "Mismatch with the chain, nothing changed" : "Failed";
  console.error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
