import {
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "@/config";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

/**
 * Classic Stellar asset operations: check a trustline, read a balance, add a
 * trustline.
 *
 * Every function takes the asset explicitly. It used to read `config.usdc`
 * internally, which was fine while the app had one USDC and became a bug the
 * moment it had two: the Earn vault runs on Blend's test USDC while the
 * lending pool runs on a different issuer's, and a helper named
 * `getUsdcBalance` cannot tell you which one it meant. In Stellar an asset is
 * its code *and* its issuer, so "USDC" alone names nothing.
 */

/** A classic Stellar asset: `code` alone is not an identity, the issuer is half of it. */
export interface ClassicAsset {
  code: string;
  issuer: string;
}

/** The pool's USDC, used by the borrow and lend flows. */
export const POOL_ASSET: ClassicAsset = config.usdc;

/** The asset the DeFindex vault accepts, used by the Earn flows. */
export const EARN_ASSET: ClassicAsset = config.earn.asset;

function toSdkAsset(asset: ClassicAsset): Asset {
  if (!asset.issuer) {
    throw new Error(`No issuer configured for the ${asset.code} asset (see .env.example)`);
  }
  return new Asset(asset.code, asset.issuer);
}

function findBalanceLine(
  balances: Horizon.HorizonApi.BalanceLine[],
  asset: ClassicAsset,
) {
  return balances.find(
    (b) =>
      "asset_code" in b &&
      b.asset_code === asset.code &&
      "asset_issuer" in b &&
      b.asset_issuer === asset.issuer,
  );
}

/** Whether the account already holds a trustline for `asset`. */
export async function hasTrustline(
  address: string,
  asset: ClassicAsset,
): Promise<boolean> {
  if (!asset.issuer) return false;
  const horizon = new Horizon.Server(config.horizonUrl);
  try {
    const account = await horizon.loadAccount(address);
    return findBalanceLine(account.balances, asset) !== undefined;
  } catch {
    return false; // unfunded account or transient read error
  }
}

/**
 * The account's spendable balance of `asset`, in stroops (7 decimals).
 *
 * Returns null only when the account genuinely holds no trustline for it, and
 * throws when Horizon could not be read. The distinction matters: callers
 * display this number and gate a deposit on it, so "you have none" and "we
 * could not check" must not collapse into the same value. Conflating them
 * blanks a balance that is actually there whenever Horizon hiccups.
 *
 * Read from Horizon rather than the SAC contract because a classic asset's
 * authoritative balance is the trustline, and the trustline is what a deposit
 * actually spends.
 */
export async function getAssetBalance(
  address: string,
  asset: ClassicAsset,
): Promise<bigint | null> {
  if (!asset.issuer) return null;
  const horizon = new Horizon.Server(config.horizonUrl);
  const account = await horizon.loadAccount(address);
  const line = findBalanceLine(account.balances, asset);
  if (!line) return null;
  // Horizon reports balances as decimal strings with 7 places, e.g. "12.5000000".
  const [whole, frac = ""] = line.balance.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0").slice(0, 7));
}

/**
 * Establishes a trustline to `asset` so the account can hold and spend it.
 * Builds a classic changeTrust transaction, has the user sign it with their
 * Stellar wallet, and submits it to Horizon.
 */
export async function enableTrustline(params: {
  address: string;
  asset: ClassicAsset;
  signTransaction: SignTransaction;
}): Promise<void> {
  const { address, asset, signTransaction } = params;
  const horizon = new Horizon.Server(config.horizonUrl);
  const account = await horizon.loadAccount(address);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: toSdkAsset(asset) }))
    .setTimeout(120)
    .build();

  const { signedTxXdr } = await signTransaction(tx.toXDR());
  const signed = TransactionBuilder.fromXDR(signedTxXdr, config.networkPassphrase);
  await horizon.submitTransaction(signed);
}
