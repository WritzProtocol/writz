import { contract, scValToNative, type xdr } from "@stellar/stellar-sdk";
import { config } from "@/config";
import { READ_ONLY_SOURCE } from "@/lib/contracts/writzLend";

/** A simulated call to a contract the app has no generated bindings for; `publicKey` is the source for writes. */
export function callContract<T>(params: {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  publicKey?: string;
}): Promise<contract.AssembledTransaction<T>> {
  return contract.AssembledTransaction.build<T>({
    contractId: params.contractId,
    method: params.method,
    args: params.args,
    publicKey: params.publicKey ?? READ_ONLY_SOURCE,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    parseResultXdr: (v) => scValToNative(v) as T,
  });
}
