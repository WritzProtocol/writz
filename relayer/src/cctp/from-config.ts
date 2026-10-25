/**
 * Builds the CCTP relay from the relayer's configuration, or explains why it
 * stays off. Kept apart from `service.ts` so tests of the relay never open
 * the sqlite store, load viem or read the environment.
 */
import { config } from "../config.js";
import { lendingEnabled } from "../deploy-target.js";
import { createEvmRelayChain } from "./evm-chain.js";
import { openSqliteRelayStore } from "./sqlite-store.js";
import { CctpRelay } from "./service.js";

export interface RelaySetup {
  relay: CctpRelay | undefined;
  disabledReason: string;
}

export function cctpRelayFromConfig(): RelaySetup {
  const c = config.cctpRelay;
  // Base Sepolia is a test network: the relay belongs to the testnet product
  // only. The mainnet target also refuses to boot with the key set.
  if (!lendingEnabled(config.target)) {
    return { relay: undefined, disabledReason: "this relayer serves mainnet, where the relay does not run" };
  }
  if (!c.evmKey) return { relay: undefined, disabledReason: "no relay key is configured" };
  if (!c.enabled) return { relay: undefined, disabledReason: "the relay is switched off by the operator" };

  const relay = new CctpRelay({
    chain: createEvmRelayChain({ privateKey: c.evmKey, rpcUrl: c.rpcUrl, mintLookbackBlocks: c.mintLookbackBlocks }),
    store: openSqliteRelayStore(),
    settings: {
      irisUrl: c.irisUrl,
      confirmTimeoutMs: c.confirmTimeoutMinutes * 60_000,
      dailyCap: c.dailyCap,
      maxOpen: c.maxOpen,
      pollInitialMs: 3_000,
      pollMaxMs: 30_000,
    },
  });
  return { relay, disabledReason: "" };
}
