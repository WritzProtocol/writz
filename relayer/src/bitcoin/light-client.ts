/**
 * Read-only view of the on-chain bitcoin-spv light client.
 *
 * A proof for a block the light client does not store yet fails on-chain with
 * HeaderNotFound (#22), and one deeper than its best tip allows fails with
 * InsufficientConfirmations. The proof route reads the best tip here so it
 * can answer "not yet, retry shortly" before a caller spends a transaction.
 *
 * @stellar/stellar-sdk is required lazily (see repay-watcher/poller.ts for
 * why: its CJS build breaks ts-jest's loader).
 */
import { config } from "../config.js";

// `get_best_tip` checks no auth, so the simulation source can be any
// syntactically valid account; it does not need to exist (same pattern as
// READ_ONLY_SOURCE in routes/merkle.ts).
const READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** bitcoin-spv's best-tip height, or undefined when it is not configured,
 * has no tip, or the read fails. Callers treat undefined as "unknown". */
export async function readLightClientTipHeight(): Promise<number | undefined> {
  if (!config.bitcoinSpvId) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment.
  const sdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const { Account, Contract, TransactionBuilder, scValToNative, rpc } = sdk;
  try {
    const server = new rpc.Server(config.stellarRpcUrl, { allowHttp: config.stellarRpcUrl.startsWith("http://") });
    const tx = new TransactionBuilder(new Account(READ_ONLY_SOURCE, "0"), {
      fee: "100",
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(new Contract(config.bitcoinSpvId).call("get_best_tip"))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || !sim.result) return undefined;
    const tip = scValToNative(sim.result.retval) as { height?: number } | undefined;
    return typeof tip?.height === "number" ? tip.height : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wraps a tip reader so that concurrent callers share one in-flight read and
 * a result is reused for `ttlMs`. Under event load every proof request asks
 * for the tip; without this each one would be its own Soroban RPC call.
 * A failed read (undefined) is cached the same way, so an RPC outage does not
 * turn into one RPC call per proof request.
 */
export function cachedTipReader(
  read: () => Promise<number | undefined>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<number | undefined> {
  let value: number | undefined;
  let fetchedAt = -Infinity;
  let inflight: Promise<number | undefined> | null = null;
  return () => {
    if (now() - fetchedAt < ttlMs) return Promise.resolve(value);
    if (!inflight) {
      inflight = read()
        .catch(() => undefined)
        .then((v) => {
          value = v;
          fetchedAt = now();
          inflight = null;
          return v;
        });
    }
    return inflight;
  };
}
