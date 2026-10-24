import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { ContractError, contractErrorCode, type ContractName } from "./errors.js";
import type { NetworkPreset } from "./types.js";

/** The subset of `rpc.Server` this package uses, so tests and custom transports can stand in for it. */
export type RpcServer = Pick<
  rpc.Server,
  "simulateTransaction" | "getAccount" | "prepareTransaction" | "sendTransaction" | "pollTransaction"
>;

export interface ContractClientOptions {
  network: NetworkPreset;
  /** Overrides `network.rpcUrl`. */
  rpcUrl?: string;
  /** A ready server; overrides `rpcUrl`. */
  server?: RpcServer;
  /** Overrides the contract ID from `network.contracts`. */
  contractId?: string;
}

/** Shared plumbing of the contract clients: simulate reads, prepare writes. */
export class ContractCaller {
  readonly server: RpcServer;
  readonly contract: Contract;
  readonly networkPassphrase: string;

  constructor(
    readonly name: ContractName,
    contractId: string,
    opts: ContractClientOptions,
  ) {
    this.server = opts.server ?? new rpc.Server(opts.rpcUrl ?? opts.network.rpcUrl);
    this.contract = new Contract(contractId);
    this.networkPassphrase = opts.network.networkPassphrase;
  }

  get contractId(): string {
    return this.contract.contractId();
  }

  /**
   * Simulates a call and returns its decoded result. Reads never sign and
   * never pay: the source is a random account that does not have to exist.
   */
  async read(method: string, ...args: xdr.ScVal[]): Promise<unknown> {
    const reader = new Account(Keypair.random().publicKey(), "0");
    const tx = new TransactionBuilder(reader, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new ContractError(this.name, method, contractErrorCode(sim.error), sim.error);
    }
    if (!sim.result) throw new ContractError(this.name, method, undefined, "simulation returned no result");
    return scValToNative(sim.result.retval);
  }

  /**
   * Builds an unsigned, simulated and assembled transaction for `source`
   * (footprint, resource fee and auth entries set), as base64 XDR ready for
   * a wallet to sign. `source` must be a funded account.
   */
  async prepare(source: string, method: string, ...args: xdr.ScVal[]): Promise<string> {
    const account = await this.server.getAccount(source);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(300)
      .build();
    try {
      const prepared = await this.server.prepareTransaction(tx);
      return prepared.toXDR();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ContractError(this.name, method, contractErrorCode(detail), detail);
    }
  }
}

export interface SubmitResult {
  hash: string;
  ledger: number;
  /** Decoded return value of the contract call, if any. */
  returnValue: unknown;
}

/**
 * Sends a signed transaction (base64 XDR) and waits until it is in a ledger.
 * Throws if the network rejects it or it fails on chain.
 */
export async function submitTransaction(
  server: RpcServer,
  signedXdr: string,
  networkPassphrase: string,
): Promise<SubmitResult> {
  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    throw new Error(`transaction ${sent.hash} was not accepted: ${sent.status}`);
  }
  const done = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`transaction ${sent.hash} ended with status ${done.status}`);
  }
  return {
    hash: sent.hash,
    ledger: done.ledger,
    returnValue: done.returnValue ? scValToNative(done.returnValue) : undefined,
  };
}
