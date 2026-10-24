import { testnet } from "./networks.generated.js";
import { RelayerClient, type RelayerClientOptions } from "./relayer.js";
import { BitcoinSpvClient } from "./spv.js";
import { WritzLendClient } from "./lend.js";
import { submitTransaction, type RpcServer, type SubmitResult } from "./soroban.js";
import { rpc } from "@stellar/stellar-sdk";
import type { NetworkPreset, SpvProof, VerificationResult } from "./types.js";

export { testnet };
/** Network presets by name. Generated from the deployment record of the Writz repository. */
export const networks = { testnet } as const;

export { RelayerClient } from "./relayer.js";
export type { RelayerClientOptions, GetSpvProofOptions, FetchLike } from "./relayer.js";
export { BitcoinSpvClient, verifyTransactionArgs, decodeVerificationResult } from "./spv.js";
export { WritzLendClient, decodePosition, decodeProtocolState } from "./lend.js";
export { ContractCaller, submitTransaction } from "./soroban.js";
export type { ContractClientOptions, RpcServer, SubmitResult } from "./soroban.js";
export {
  WritzError,
  RelayerError,
  ContractError,
  SPV_ERRORS,
  WRITZ_LEND_ERRORS,
  contractErrorCode,
} from "./errors.js";
export type { RelayerErrorCode, ContractName } from "./errors.js";
export { hexToBytes, bytesToHex, reverseHex, isHash } from "./hex.js";
export type * from "./types.js";

export interface WritzClientOptions {
  /** Default `testnet`. */
  network?: NetworkPreset;
  rpcUrl?: string;
  server?: RpcServer;
  relayer?: Omit<RelayerClientOptions, "network">;
}

export interface WritzClient {
  network: NetworkPreset;
  relayer: RelayerClient;
  spv: BitcoinSpvClient;
  lend: WritzLendClient;
  /**
   * Fetches a proof for a signet txid (display order) from the relayer and
   * verifies it against `bitcoin-spv` by simulation. Read-only.
   */
  verifyBitcoinTx(txid: string, confirmations?: number): Promise<{ proof: SpvProof; result: VerificationResult }>;
  /** Sends a transaction signed by a wallet and waits for it to land. */
  submit(signedXdr: string): Promise<SubmitResult>;
}

/** The relayer, `bitcoin-spv` and `writz-lend` clients for one network, sharing one RPC server. */
export function createWritzClient(opts: WritzClientOptions = {}): WritzClient {
  const network = opts.network ?? testnet;
  const server = opts.server ?? new rpc.Server(opts.rpcUrl ?? network.rpcUrl);
  const relayer = new RelayerClient({ ...opts.relayer, network });
  const spv = new BitcoinSpvClient({ network, server });
  const lend = new WritzLendClient({ network, server });
  return {
    network,
    relayer,
    spv,
    lend,
    async verifyBitcoinTx(txid, confirmations = 6) {
      const proof = await relayer.getSpvProof(txid, { confirmations });
      const result = await spv.verifyTransaction(proof.sorobanArgs);
      return { proof, result };
    },
    submit: (signedXdr) => submitTransaction(server, signedXdr, network.networkPassphrase),
  };
}
