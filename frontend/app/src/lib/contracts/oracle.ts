import { Account, BASE_FEE, Contract, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { config, requireContract } from "@/config";
import { READ_ONLY_SOURCE } from "./writzLend";

/**
 * The BTC/USD price `writz-lend` prices collateral with: Reflector's SEP-40
 * `lastprice(Other("BTC"))`, converted to USDC stroops per BTC exactly as
 * `contracts/contracts/writz-lend/src/oracle.rs` does, and refused when older
 * than the contract's staleness window.
 */

/** `oracle::MAX_PRICE_STALENESS_SECS`: older prices fail every price-dependent call. */
export const MAX_PRICE_AGE_SECS = 3_600;
const USDC_DECIMALS = 7;

/** Pure: Reflector's raw price at `decimals` as USDC stroops per BTC, or an error the contract would also raise. */
export function priceToStroops(raw: { price: bigint; timestamp: bigint }, decimals: number, nowSecs: number): bigint {
  if (nowSecs - Number(raw.timestamp) > MAX_PRICE_AGE_SECS) throw new Error("OraclePriceStale");
  const stroops =
    decimals >= USDC_DECIMALS
      ? raw.price / 10n ** BigInt(decimals - USDC_DECIMALS)
      : raw.price * 10n ** BigInt(USDC_DECIMALS - decimals);
  if (stroops <= 0n) throw new Error("OraclePriceUnavailable");
  return stroops;
}

async function simulateRead(contractId: string, method: string, ...args: xdr.ScVal[]): Promise<unknown> {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
  const tx = new TransactionBuilder(new Account(READ_ONLY_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result) throw new Error(`${method} returned nothing`);
  return scValToNative(sim.result.retval);
}

/** The oracle's BTC price in USDC stroops per BTC. */
export async function getBtcPriceStroops(): Promise<bigint> {
  const oracle = requireContract(config.contracts.btcOracle, "the BTC price oracle");
  const btc = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Other"), xdr.ScVal.scvSymbol("BTC")]);
  const [last, decimals] = await Promise.all([simulateRead(oracle, "lastprice", btc), simulateRead(oracle, "decimals")]);
  if (!last) throw new Error("OraclePriceUnavailable");
  const { price, timestamp } = last as { price: bigint; timestamp: bigint };
  return priceToStroops({ price: BigInt(price), timestamp: BigInt(timestamp) }, Number(decimals), Math.floor(Date.now() / 1000));
}
