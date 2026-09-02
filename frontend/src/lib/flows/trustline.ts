import {
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "@/config";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

function usdcAsset(): Asset {
  if (!config.usdc.issuer) throw new Error("NEXT_PUBLIC_USDC_ISSUER is not configured");
  return new Asset(config.usdc.code, config.usdc.issuer);
}

/** Whether the account already holds a trustline for the pool's USDC asset. */
export async function hasUsdcTrustline(address: string): Promise<boolean> {
  if (!config.usdc.issuer) return false;
  const horizon = new Horizon.Server(config.horizonUrl);
  try {
    const account = await horizon.loadAccount(address);
    return account.balances.some(
      (b) =>
        "asset_code" in b &&
        b.asset_code === config.usdc.code &&
        "asset_issuer" in b &&
        b.asset_issuer === config.usdc.issuer,
    );
  } catch {
    return false; // unfunded account or transient read error
  }
}

/**
 * The account's spendable USDC balance, in stroops (7 decimals).
 *
 * Returns null only when the account genuinely holds no USDC trustline, and
 * throws when Horizon could not be read. The distinction matters: callers
 * display this number and gate a deposit on it, so "you have no USDC" and "we
 * could not check" must not collapse into the same value. Conflating them
 * blanks a balance that is actually there whenever Horizon hiccups.
 *
 * Read from Horizon rather than the SAC contract because a classic asset's
 * authoritative balance is the trustline, and the trustline is what a deposit
 * actually spends.
 */
export async function getUsdcBalance(address: string): Promise<bigint | null> {
  if (!config.usdc.issuer) return null;
  const horizon = new Horizon.Server(config.horizonUrl);
  const account = await horizon.loadAccount(address);
  const line = account.balances.find(
    (b) =>
      "asset_code" in b &&
      b.asset_code === config.usdc.code &&
      "asset_issuer" in b &&
      b.asset_issuer === config.usdc.issuer,
  );
  if (!line) return null;
  // Horizon reports balances as decimal strings with 7 places, e.g. "12.5000000".
  const [whole, frac = ""] = line.balance.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0").slice(0, 7));
}

/**
 * Establishes a trustline to the pool's USDC asset so the account can receive
 * borrowed funds. Builds a classic changeTrust transaction, has the user sign
 * it with their Stellar wallet, and submits it to Horizon.
 */
export async function enableUsdcTrustline(params: {
  address: string;
  signTransaction: SignTransaction;
}): Promise<void> {
  const { address, signTransaction } = params;
  const horizon = new Horizon.Server(config.horizonUrl);
  const account = await horizon.loadAccount(address);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: usdcAsset() }))
    .setTimeout(120)
    .build();

  const { signedTxXdr } = await signTransaction(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedTxXdr, config.networkPassphrase);
  await horizon.submitTransaction(signed);
}
