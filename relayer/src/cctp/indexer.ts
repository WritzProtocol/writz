/**
 * Second source for the mint that spent a nonce: a public Base Sepolia
 * indexer (Blockscout, no key), asked for the `MessageReceived` log by its
 * indexed nonce over the whole chain. The relay's RPC search only reaches
 * back `CCTP_RELAY_MINT_LOOKBACK_BLOCKS`, because the public RPC answers
 * `eth_getLogs` over 200 blocks at a time; a transfer someone else completed
 * before that window is only found here.
 *
 * The indexer is a third party, so nothing it answers is taken on trust: a
 * log counts only if it was emitted by MessageTransmitterV2, carries the
 * `MessageReceived` signature as its first topic and the nonce asked for as
 * its indexed nonce. The relay only reads this to link the transaction; the
 * nonce being spent is always established from the chain (`usedNonces`).
 */
import { BASE_SEPOLIA_MESSAGE_TRANSMITTER } from "./message.js";
import type { MintLog } from "./chain.js";

/** keccak256("MessageReceived(address,uint32,bytes32,bytes32,uint32,bytes)"), topic 0 of every MessageTransmitterV2 receive. */
export const MESSAGE_RECEIVED_TOPIC = "0xff48c13eda96b1cceacc6b9edeedc9e9db9d6226afbc30146b720c19d3addb1c";

export const DEFAULT_MINT_INDEXER_URL = "https://base-sepolia.blockscout.com/api";

export class IndexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexerError";
  }
}

interface EtherscanLog {
  address?: string;
  topics?: (string | null)[];
  transactionHash?: string;
}

const HASH = /^0x[0-9a-f]{64}$/;

/**
 * The transaction that received the message with `nonce`, from the indexer's
 * etherscan-compatible `logs/getLogs`. Undefined when the indexer has no such
 * log; throws `IndexerError` when it cannot be asked (timeout, HTTP error, a
 * body it does not recognise), so the caller can tell "not there" from "not
 * reachable" and retry the second later.
 */
export async function findMintOnIndexer(
  apiUrl: string,
  nonce: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<MintLog | undefined> {
  const want = nonce.toLowerCase();
  if (!HASH.test(want)) throw new IndexerError(`not a nonce: ${nonce}`);
  const transmitter = BASE_SEPOLIA_MESSAGE_TRANSMITTER.toLowerCase();
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: transmitter,
    fromBlock: "0",
    toBlock: "latest",
    topic0: MESSAGE_RECEIVED_TOPIC,
    topic2: want,
    topic0_2_opr: "and",
  });
  const url = `${apiUrl.replace(/\/+$/, "")}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new IndexerError(`indexer request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new IndexerError(`indexer answered ${res.status}`);
  let body: { status?: string; message?: string; result?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new IndexerError("indexer answered with a body that is not JSON");
  }
  if (!Array.isArray(body.result)) {
    // Etherscan-style APIs report errors (rate limits, bad parameters) as a
    // status "0" with a string in `result`, and an empty match the same way
    // with an empty array; only the array is an answer.
    throw new IndexerError(`indexer refused the query: ${body.message ?? "unknown error"}`);
  }

  for (const log of body.result as EtherscanLog[]) {
    const topics = (log.topics ?? []).map((t) => (typeof t === "string" ? t.toLowerCase() : ""));
    const txHash = log.transactionHash?.toLowerCase();
    if (log.address?.toLowerCase() !== transmitter) continue;
    if (topics[0] !== MESSAGE_RECEIVED_TOPIC || topics[2] !== want) continue;
    if (!txHash || !HASH.test(txHash) || !topics[1] || !HASH.test(topics[1])) continue;
    // topic 1 is the indexed caller, left-padded to 32 bytes.
    return { txHash, caller: `0x${topics[1].slice(26)}` };
  }
  return undefined;
}
