/**
 * `RelayChain` on Base Sepolia through viem: reads and the simulation go to
 * the configured RPC, and the mint is signed locally with the relay key.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  WaitForTransactionReceiptTimeoutError,
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_MESSAGE_TRANSMITTER } from "./message.js";
import { SendError, type MintLog, type ReceiptOutcome, type RelayChain, type SimulateOutcome } from "./chain.js";

export const MESSAGE_TRANSMITTER_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
  "function usedNonces(bytes32 nonce) view returns (uint256)",
  "event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody)",
]);

/** The public Base Sepolia RPC answers eth_getLogs over at most 200 blocks. */
const LOG_CHUNK_BLOCKS = 200n;
/** How long one wait for a receipt lasts; Base Sepolia makes a block every 2 seconds. */
const RECEIPT_TIMEOUT_MS = 90_000;

export interface EvmChainOptions {
  privateKey: Hex;
  rpcUrl: string;
  /** How far back from the head `findMint` searches, in blocks. */
  mintLookbackBlocks: number;
}

/** The viem error of class `cls` anywhere in `e`'s cause chain. */
function find<T extends Error>(e: unknown, cls: new (...args: never[]) => T): T | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const hit = e.walk((err) => err instanceof cls);
  return hit instanceof cls ? hit : undefined;
}

const short = (e: unknown) => (e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e));

export function createEvmRelayChain(opts: EvmChainOptions): RelayChain {
  const account = privateKeyToAccount(opts.privateKey);
  const transport = http(opts.rpcUrl, { timeout: 15_000, retryCount: 2 });
  const client = createPublicClient({ chain: baseSepolia, transport });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const address = BASE_SEPOLIA_MESSAGE_TRANSMITTER as Hex;

  // An RPC URL for another chain would sign Base Sepolia transactions against
  // the wrong network; check once, before the first write, rather than trust the variable.
  let chainChecked: Promise<void> | undefined;
  const checkChain = () => {
    chainChecked ??= client.getChainId().then((id) => {
      if (id !== BASE_SEPOLIA_CHAIN_ID) {
        throw new Error(`CCTP_RELAY_RPC_URL serves chain ${id}, not Base Sepolia (${BASE_SEPOLIA_CHAIN_ID})`);
      }
    });
    chainChecked.catch(() => (chainChecked = undefined));
    return chainChecked;
  };

  return {
    address: account.address,

    balanceWei: () => client.getBalance({ address: account.address }),

    async isNonceUsed(nonce) {
      const used = await client.readContract({
        address,
        abi: MESSAGE_TRANSMITTER_ABI,
        functionName: "usedNonces",
        args: [nonce as Hex],
      });
      return used !== 0n;
    },

    async findMint(nonce): Promise<MintLog | undefined> {
      const head = await client.getBlockNumber();
      const floor = head > BigInt(opts.mintLookbackBlocks) ? head - BigInt(opts.mintLookbackBlocks) : 0n;
      for (let to = head; to >= floor; to -= LOG_CHUNK_BLOCKS) {
        const from = to - LOG_CHUNK_BLOCKS + 1n > floor ? to - LOG_CHUNK_BLOCKS + 1n : floor;
        const logs = await client.getContractEvents({
          address,
          abi: MESSAGE_TRANSMITTER_ABI,
          eventName: "MessageReceived",
          args: { nonce: nonce as Hex },
          fromBlock: from,
          toBlock: to,
        });
        const log = logs[0];
        if (log?.transactionHash) return { txHash: log.transactionHash, caller: log.args.caller ?? "" };
        if (from === floor) break;
      }
      return undefined;
    },

    async simulateReceive(message, attestation): Promise<SimulateOutcome> {
      try {
        await checkChain();
        await client.simulateContract({
          account,
          address,
          abi: MESSAGE_TRANSMITTER_ABI,
          functionName: "receiveMessage",
          args: [message as Hex, attestation as Hex],
        });
        return { ok: true };
      } catch (e) {
        const revert = find(e, ContractFunctionRevertedError);
        if (revert) {
          return { ok: false, transient: false, revert: revert.reason ?? revert.data?.errorName ?? revert.shortMessage, detail: short(e) };
        }
        return { ok: false, transient: true, detail: short(e) };
      }
    },

    async sendReceive(message, attestation) {
      try {
        await checkChain();
        return await wallet.writeContract({
          address,
          abi: MESSAGE_TRANSMITTER_ABI,
          functionName: "receiveMessage",
          args: [message as Hex, attestation as Hex],
        });
      } catch (e) {
        // An empty account usually fails in gas estimation ("gas required
        // exceeds allowance (0)") before any InsufficientFundsError, so the
        // balance itself decides when the message does not.
        const detail = short(e) + (e instanceof BaseError ? ` ${e.details ?? ""}` : "");
        const empty =
          find(e, InsufficientFundsError) !== undefined ||
          /insufficient funds|exceeds allowance \(0\)/i.test(detail) ||
          (await client.getBalance({ address: account.address }).catch(() => undefined)) === 0n;
        throw new SendError(empty ? "insufficient_funds" : "failed", short(e));
      }
    },

    async waitForReceipt(txHash): Promise<ReceiptOutcome> {
      try {
        const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex, timeout: RECEIPT_TIMEOUT_MS });
        return receipt.status === "success" ? "success" : "reverted";
      } catch (e) {
        if (e instanceof WaitForTransactionReceiptTimeoutError) return "pending";
        throw e;
      }
    },
  };
}
