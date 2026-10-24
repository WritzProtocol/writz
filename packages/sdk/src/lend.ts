import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { bytesToHex, hexToBytes, isHash } from "./hex.js";
import { ContractCaller, type ContractClientOptions } from "./soroban.js";
import type { Position, PositionStatus, ProtocolState } from "./types.js";

type Raw = Record<string, unknown>;
const big = (v: unknown) => BigInt(v as bigint);
const hexOf = (v: unknown) => bytesToHex(v as Uint8Array);
const address = (a: string) => new Address(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

function txidArg(txid: string) {
  if (!isHash(txid)) throw new TypeError("txid must be 64 hex characters, internal byte order");
  return nativeToScVal(hexToBytes(txid));
}

function positiveAmount(amount: bigint): bigint {
  if (typeof amount !== "bigint" || amount <= 0n) throw new RangeError("amount must be a positive bigint of USDC stroops");
  return amount;
}

export function decodeProtocolState(v: unknown): ProtocolState {
  const r = v as Raw;
  return {
    totalScaledSupply: big(r.total_scaled_supply),
    supplyIndex: big(r.supply_index),
    totalBorrowed: big(r.total_borrowed),
    reserveUsdc: big(r.reserve_usdc),
    borrowIndex: big(r.borrow_index),
    indexLedger: Number(r.index_ledger),
    lastKeeperHeartbeat: big(r.last_keeper_heartbeat),
  };
}

export function decodePosition(v: unknown): Position {
  const r = v as Raw;
  const status = (Array.isArray(r.status) ? r.status[0] : r.status) as PositionStatus;
  return {
    btcTxid: hexOf(r.btc_txid),
    btcSatoshis: big(r.btc_satoshis),
    usdcDebt: big(r.usdc_debt),
    p2wshScriptPubkey: hexOf(r.p2wsh_script_pubkey),
    timelockHeight: Number(r.timelock_height),
    lastUpdateLedger: Number(r.last_update_ledger),
    debtIndex: big(r.debt_index),
    depositor: String(r.depositor),
    status,
    userPubkey: hexOf(r.user_pubkey),
  };
}

/**
 * Client for the `writz-lend` pool: simulated reads, and unsigned lender
 * transactions (`supply_usdc`, `withdraw_supply`) for a wallet to sign.
 * USDC amounts are bigint stroops (7 decimals: 10_000_000n is 1 USDC).
 */
export class WritzLendClient {
  private readonly c: ContractCaller;

  constructor(opts: ContractClientOptions) {
    this.c = new ContractCaller("writz-lend", opts.contractId ?? opts.network.contracts.writzLend, opts);
  }

  get contractId(): string {
    return this.c.contractId;
  }

  async getProtocolState(): Promise<ProtocolState> {
    return decodeProtocolState(await this.c.read("get_protocol_state"));
  }

  /** Annual borrow rate in basis points (800 is 8%). */
  async getBorrowRateBp(): Promise<number> {
    return Number(await this.c.read("get_borrow_rate_bp"));
  }

  /** Annual supply rate in basis points. */
  async getSupplyRateBp(): Promise<number> {
    return Number(await this.c.read("get_supply_rate_bp"));
  }

  /** A lender's supplied USDC including accrued interest, in stroops. */
  async getSupplyBalance(lender: string): Promise<bigint> {
    return big(await this.c.read("get_supply_balance", address(lender)));
  }

  /** A position by its BTC deposit txid (internal byte order), or `null`. */
  async getPosition(txid: string): Promise<Position | null> {
    const r = await this.c.read("get_position", txidArg(txid));
    return r ? decodePosition(r) : null;
  }

  /**
   * Health ratio in basis points (15000 is 150%; liquidation at 12000). A
   * position without debt returns the i128 maximum. Throws `ContractError`
   * 8 PositionNotFound for an unknown txid.
   */
  async getHealthRatioBp(txid: string): Promise<bigint> {
    return big(await this.c.read("get_health_ratio_bp", txidArg(txid)));
  }

  /**
   * An unsigned `supply_usdc` transaction (base64 XDR): `supplier` lends
   * `amount` USDC stroops to the pool and earns the supply rate. The
   * supplier signs; it needs a USDC trustline and the balance.
   */
  async buildSupplyUsdc(supplier: string, amount: bigint): Promise<string> {
    return this.c.prepare(supplier, "supply_usdc", address(supplier), i128(positiveAmount(amount)));
  }

  /** An unsigned `withdraw_supply` transaction (base64 XDR) for `amount` USDC stroops. */
  async buildWithdrawSupply(supplier: string, amount: bigint): Promise<string> {
    return this.c.prepare(supplier, "withdraw_supply", address(supplier), i128(positiveAmount(amount)));
  }
}
