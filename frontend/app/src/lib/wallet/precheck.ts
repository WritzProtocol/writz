import { FeeBumpTransaction, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

const STROOPS_PER_XLM = 10_000_000n;
const BASE_RESERVE = STROOPS_PER_XLM / 2n;

/** The fields of a Horizon account record the funding checks need. */
export interface AccountSnapshot {
  balances: { asset_type: string; balance: string; selling_liabilities?: string }[];
  subentry_count: number;
  num_sponsoring?: number;
  num_sponsored?: number;
}

export class WrongNetworkError extends Error {
  constructor(
    readonly walletPassphrase: string,
    readonly walletName?: string,
  ) {
    super("WrongNetwork");
    this.name = "WrongNetworkError";
  }
}

export class AccountUnfundedError extends Error {
  constructor() {
    super("AccountUnfunded");
    this.name = "AccountUnfundedError";
  }
}

export class LowXlmError extends Error {
  constructor(
    readonly neededStroops: bigint,
    readonly spendableStroops: bigint,
  ) {
    super("LowXlm");
    this.name = "LowXlmError";
  }
}

/** "12.5000000" to 125000000n. */
export function toStroops(decimal: string): bigint {
  const [whole, frac = ""] = decimal.split(".");
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(frac.padEnd(7, "0").slice(0, 7));
}

/** XLM the account can spend: its balance minus the minimum reserve and open selling offers. */
export function spendableXlm(account: AccountSnapshot): bigint {
  const native = account.balances.find((b) => b.asset_type === "native");
  if (!native) return 0n;
  const entries =
    2 + account.subentry_count + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0);
  const reserve = BigInt(entries) * BASE_RESERVE;
  const liabilities = toStroops(native.selling_liabilities ?? "0");
  const spendable = toStroops(native.balance) - reserve - liabilities;
  return spendable > 0n ? spendable : 0n;
}

/** How a network passphrase is named to the user. */
export function networkName(passphrase: string): string {
  switch (passphrase) {
    case Networks.TESTNET:
      return "Stellar testnet";
    case Networks.PUBLIC:
      return "Stellar mainnet";
    case Networks.FUTURENET:
      return "Futurenet";
    default:
      return "another network";
  }
}

/** XLM a transaction needs to go through: its maximum fee plus the reserve of every trustline it adds. */
export function requiredXlm(xdr: string, passphrase: string): bigint {
  const tx = TransactionBuilder.fromXDR(xdr, passphrase);
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  const newLines = inner.operations.filter(
    (op) => op.type === "changeTrust" && op.limit !== "0.0000000",
  ).length;
  return BigInt(tx.fee) + BigInt(newLines) * BASE_RESERVE;
}

export function assertNetwork(
  walletPassphrase: string | null,
  expected: string,
  walletName?: string,
): void {
  if (walletPassphrase && walletPassphrase !== expected) {
    throw new WrongNetworkError(walletPassphrase, walletName);
  }
}

/** `account` null means it does not exist on chain yet. */
export function assertFunds(account: AccountSnapshot | null, neededStroops: bigint): void {
  if (!account) throw new AccountUnfundedError();
  const spendable = spendableXlm(account);
  if (spendable < neededStroops) throw new LowXlmError(neededStroops, spendable);
}

/**
 * Checks before the wallet prompt opens: the wallet is on the app's network,
 * the account exists and it holds the XLM this transaction needs. A check
 * that cannot be read (a wallet without `getNetwork`, a Horizon hiccup) is
 * skipped rather than blocking the signature.
 */
export async function preflightSign(params: {
  xdr: string;
  expectedPassphrase: string;
  walletName?: string;
  getWalletPassphrase: () => Promise<string | null>;
  loadAccount: () => Promise<AccountSnapshot | null>;
}): Promise<void> {
  const { xdr, expectedPassphrase, walletName } = params;
  const walletPassphrase = await params.getWalletPassphrase().catch(() => null);
  assertNetwork(walletPassphrase, expectedPassphrase, walletName);

  let account: AccountSnapshot | null;
  try {
    account = await params.loadAccount();
  } catch {
    return;
  }
  assertFunds(account, requiredXlm(xdr, expectedPassphrase));
}
